"""dbt manifest 로더 — 카탈로그·컬럼·계보의 유일한 출처.

화면이 요구하는 정보(카탈로그 목록, 컬럼, 계보, 영향 범위, 품질 규칙)는
거의 전부 manifest.json 안에 이미 있다. 별도 메타DB에 옮겨 적으면 dbt 쪽
변경과 어긋나므로, 여기서 읽어 그때그때 화면 모양으로 바꿔 내보낸다.

파싱 비용(2.7MB JSON)은 mtime 기준 캐시로 흡수한다. 모델을 저장하면
dbt parse 가 manifest 를 다시 쓰고, mtime 이 바뀌면서 캐시가 자연히 무효화된다.
"""

from __future__ import annotations

import json
import threading
from typing import Any

from .config import CATALOG_PATH, DBT_PROJECT_NAME, MANIFEST_PATH

_lock = threading.Lock()
_cache: dict[str, Any] = {"mtime": None, "data": None, "index": None}

# Data Mates 은 분류를 두 가지로만 쓴다. dbt 의 seed/source 는 «외부에서 들어오는 것»
# 이라는 점에서 같으므로 SOURCE 로 묶고, model 만 DATA MODEL 이다.
SOURCE_TYPES = {"seed", "source"}


def _load_raw() -> dict[str, Any]:
    if not MANIFEST_PATH.exists():
        raise FileNotFoundError(
            f"{MANIFEST_PATH} 가 없습니다. 프로젝트 루트에서 `dbt parse` 를 한 번 돌려 주세요.")
    mtime = MANIFEST_PATH.stat().st_mtime
    with _lock:
        if _cache["mtime"] == mtime and _cache["data"] is not None:
            return _cache["data"]
        data = json.loads(MANIFEST_PATH.read_text())
        _cache.update(mtime=mtime, data=data, index=None)
        return data


def invalidate() -> None:
    """dbt parse 직후 호출. mtime 비교로도 잡히지만 명시적으로 비워 경합을 줄인다."""
    with _lock:
        _cache.update(mtime=None, data=None, index=None)


def _catalog_types() -> dict[str, dict[str, str]]:
    """catalog.json 이 있으면 컬럼의 실제 물리 타입을 가져온다.

    manifest 의 columns 에는 사람이 yml 에 적은 것만 들어 있어 data_type 이 대개 비어 있다.
    catalog.json 은 `dbt docs generate` 가 웨어하우스에서 읽어온 실제 스키마다.
    없으면 타입을 비워두고 진행한다 — 있으면 좋고 없어도 되는 정보다.
    """
    if not CATALOG_PATH.exists():
        return {}
    try:
        cat = json.loads(CATALOG_PATH.read_text())
    except (json.JSONDecodeError, OSError):
        return {}
    out: dict[str, dict[str, str]] = {}
    for section in ("nodes", "sources"):
        for uid, node in cat.get(section, {}).items():
            out[uid] = {c["name"]: (c.get("type") or "")
                        for c in node.get("columns", {}).values()}
    return out


def _build_index() -> dict[str, Any]:
    """manifest 를 화면이 쓰는 모양으로 한 번에 변환해 둔다."""
    raw = _load_raw()
    with _lock:
        if _cache["index"] is not None:
            return _cache["index"]

    types = _catalog_types()

    # 1) 노드 수집 — 우리 프로젝트 패키지만. elementary 등 패키지 내부 모델은
    #    사용자가 다루는 대상이 아니라 노출하지 않는다.
    entries: dict[str, dict[str, Any]] = {}
    uid_by_id: dict[str, str] = {}

    def add(uid: str, node: dict[str, Any], rtype: str) -> None:
        name = node["name"]
        group = "SOURCE" if rtype in SOURCE_TYPES else "DATA MODEL"
        cfg = node.get("config") or {}
        schema = node.get("schema") or ""
        alias = node.get("alias") or name
        entries[name] = {
            "id": name,
            "unique_id": uid,
            "name": name,
            "phys": f"{schema}.{alias}" if schema else alias,
            "group": group,
            "kind": "source" if group == "SOURCE" else "model",
            # 화면 분류(group)와 실행 여부는 다르다. seed 는 «원천»으로 보이지만
            # 실제로는 dbt 가 CSV 를 적재하는 실행 대상이다. 반대로 source 는
            # 외부 테이블이라 dbt 가 만들지 않는다 — 최신성 검사만 한다.
            "dbt_type": rtype,
            "executable": rtype in ("model", "seed"),
            "desc": (node.get("description") or "").strip(),
            "mat": cfg.get("materialized") or ("seed" if rtype == "seed" else ""),
            "file_format": cfg.get("file_format") or "",
            "tags": list(node.get("tags") or []),
            "path": node.get("original_file_path") or "",
            "patch_path": node.get("patch_path") or "",
            "raw_columns": node.get("columns") or {},
            "types": types.get(uid, {}),
            "depends_on": [n for n in (node.get("depends_on") or {}).get("nodes", [])],
        }
        uid_by_id[uid] = name

    for uid, node in raw["nodes"].items():
        rtype = node.get("resource_type")
        if rtype not in ("model", "seed"):
            continue
        if node.get("package_name") != DBT_PROJECT_NAME:
            continue
        add(uid, node, rtype)

    for uid, node in raw.get("sources", {}).items():
        if node.get("package_name") != DBT_PROJECT_NAME:
            continue
        add(uid, node, "source")

    # 2) 테스트 수집 — 컬럼의 «필수» 여부와 품질 규칙 목록의 원천이다.
    #
    # disabled 도 함께 읽는다. enabled: false 로 꺼둔 테스트는 nodes 가 아니라
    # disabled 에 들어가는데, 그것만 보면 «잠시 꺼둔 규칙»이 화면에서 아예 사라져
    # 다시 켤 방법이 없어진다.
    test_nodes: list[tuple[str, dict[str, Any], bool]] = [
        (uid, node, True) for uid, node in raw["nodes"].items()]
    for uid, dis in (raw.get("disabled") or {}).items():
        for node in (dis if isinstance(dis, list) else [dis]):
            test_nodes.append((uid, node, False))

    tests: dict[str, list[dict[str, Any]]] = {name: [] for name in entries}
    for uid, node, enabled in test_nodes:
        if node.get("resource_type") != "test":
            continue
        if node.get("package_name") != DBT_PROJECT_NAME:
            continue
        meta = node.get("test_metadata") or {}
        cfg = node.get("config") or {}
        # 제네릭 테스트는 attached_node 가 대상 모델이라 대상이 하나로 정해진다.
        # 싱귤러 테스트에는 그 필드가 없다. depends_on 의 첫 노드를 고르는 방식은
        # 틀린다 — assert_fct_events_row_count_matches_stg 처럼 stg 와 fct 를 함께
        # 참조하는 테스트가 stg 것으로 잡힌다. 실패하면 참조한 모델 전부가 의심 대상이므로
        # 관련 모델 모두에 붙이고, targets 로 관계를 그대로 드러낸다.
        deps = [uid_by_id[u] for u in (node.get("depends_on") or {}).get("nodes") or []
                if u in uid_by_id]
        attached = uid_by_id.get(node.get("attached_node") or "")
        targets = [attached] if attached else deps
        if not targets:
            continue
        entry = {
            "id": node["name"],
            "unique_id": uid,
            "name": node["name"],
            "type": meta.get("name") or "singular",
            "col": node.get("column_name") or "",
            "severity": (cfg.get("severity") or "ERROR").lower(),
            # model 과 column_name 은 대상이지 검사 조건이 아니다.
            # 조건 문자열에 섞이면 «not_null (column_name=x)» 처럼 읽히기만 나빠진다.
            "kwargs": {k: v for k, v in (meta.get("kwargs") or {}).items()
                       if k not in ("model", "column_name")},
            "singular": not meta,
            "enabled": enabled,
            "targets": targets,
        }
        for t in targets:
            tests[t].append(entry)

    # 3) 컬럼 조립 — [실제 컬럼명, 표시 이름, 형식, 필수여부] 4튜플.
    #    화면이 이 순서를 그대로 쓴다(프로토타입의 cols 구조).
    for name, e in entries.items():
        # 「필수」는 error 급 not_null 이 걸린 컬럼만이다. severity: warn 으로 둔 것은
        # 「비어도 정상이지만 지켜본다」는 뜻이라 필수가 아니다 (stg_events.user_id 가 그 예).
        required = {t["col"] for t in tests[name]
                    if t["type"] == "not_null" and t["col"]
                    and t["severity"] == "error" and t.get("enabled", True)}
        cols = []
        for cname, c in e["raw_columns"].items():
            # 표시 이름은 dbt 에 대응 필드가 없다. meta.label 규약을 쓰고, 없으면
            # 컬럼명을 그대로 쓴다. description 을 이름 자리에 밀어 넣으면 문장이 들어간다.
            label = ((c.get("meta") or {}).get("label") or "").strip()
            cols.append([
                cname,
                label or cname,
                (c.get("data_type") or e["types"].get(cname) or "").upper(),
                "필수" if cname in required else "선택",
            ])
        # yml 에 없지만 웨어하우스에는 있는 컬럼도 보여준다(문서화 누락 표시 역할).
        for cname, ctype in e["types"].items():
            if cname not in e["raw_columns"]:
                cols.append([cname, cname, (ctype or "").upper(), "선택"])
        e["cols"] = cols
        e["col_desc"] = {cname: (c.get("description") or "").strip()
                         for cname, c in e["raw_columns"].items()}
        e["tests"] = tests[name]
        del e["raw_columns"], e["types"]

    # 4) 의존관계 — unique_id 를 우리 id 로 바꾸고, 프로젝트 밖 노드는 버린다.
    for e in entries.values():
        e["upstream"] = [uid_by_id[u] for u in e["depends_on"] if u in uid_by_id]
        del e["depends_on"]

    downstream: dict[str, list[str]] = {name: [] for name in entries}
    for name, e in entries.items():
        for up in e["upstream"]:
            downstream[up].append(name)
    for name, e in entries.items():
        e["downstream"] = sorted(downstream[name])

    index = {
        "entries": entries,
        "uid_by_id": uid_by_id,
        "dbt_version": raw["metadata"].get("dbt_version"),
        "generated_at": raw["metadata"].get("generated_at"),
    }
    with _lock:
        _cache["index"] = index
    return index


# ---------------------------------------------------------------- 공개 API

def all_entries() -> dict[str, dict[str, Any]]:
    return _build_index()["entries"]


def get(model_id: str) -> dict[str, Any] | None:
    return all_entries().get(model_id)


def meta() -> dict[str, Any]:
    idx = _build_index()
    return {"dbt_version": idx["dbt_version"], "generated_at": idx["generated_at"],
            "model_count": sum(1 for e in idx["entries"].values() if e["kind"] == "model"),
            "source_count": sum(1 for e in idx["entries"].values() if e["kind"] == "source")}


def lineage(model_id: str) -> dict[str, list[str]]:
    """계보(상류 전체) 와 영향 범위(하류 전체). 둘 다 재귀로 끝까지 따라간다."""
    entries = all_entries()
    if model_id not in entries:
        return {"upstream": [], "downstream": []}

    def walk(start: str, key: str) -> list[str]:
        seen: set[str] = set()
        stack = list(entries[start][key])
        while stack:
            cur = stack.pop()
            if cur in seen or cur not in entries:
                continue
            seen.add(cur)
            stack.extend(entries[cur][key])
        seen.discard(start)
        return sorted(seen)

    return {"upstream": walk(model_id, "upstream"), "downstream": walk(model_id, "downstream")}


def graph() -> dict[str, Any]:
    """전체 참조 관계. 관계(ERD) 화면이 그대로 그린다."""
    entries = all_entries()
    edges = [{"from": up, "to": name}
             for name, e in entries.items() for up in e["upstream"]]
    return {
        "nodes": [{"id": e["id"], "name": e["name"], "phys": e["phys"],
                   "group": e["group"], "kind": e["kind"]} for e in entries.values()],
        "edges": edges,
    }
