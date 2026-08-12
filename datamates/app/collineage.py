"""컬럼 단위 계보 — 모델 SQL 을 AST 로 분석해 컬럼 흐름을 뽑는다.

모델 단위 의존성(무엇이 무엇을 참조하나)은 dbt manifest 가 이미 갖고 있고
manifest.py 가 그대로 쓴다. 여기서 만드는 것은 그 아래 한 단계 —
어느 컬럼이 어느 컬럼으로 흘러갔나 — 이고, 이건 dbt 도 안 만들어 준다.

방법: 모델의 SQL 을 sqlglot 로 파싱해 출력 컬럼마다 입력 컬럼을 거슬러 간다.
CTE 체인·select * 전파·조인·윈도 함수를 AST 수준에서 따라가므로
CAST / CASE / 함수 / 연산에 쓰인 입력도 전부 잡힌다 (N:1 지원).

dbt compile 을 쓰지 않는 이유: dbt-spark 의 session 방식은 compile 만 해도
로컬 Spark 를 띄워 15초쯤 든다. 대신 Jinja 중 의미가 정확히 정의된 것만
직접 치환한다 —

  · {{ ref('x') }} / {{ source('a','b') }}  → manifest 가 아는 물리 이름 (dbt 와 동일)
  · {{ config(...) }}                       → 제거 (SQL 에 영향 없음)
  · {% if is_incremental() %}...{% endif %} → 제거 (풀 리프레시 시점의 SQL)
  · {{ this }}                              → 자기 물리 이름
  · {{ var('x') }}                          → null (상수는 계보에 기여하지 않음)

이 밖의 Jinja(매크로 호출, 루프)가 남으면 **추측하지 않고** 그 모델을
확인 불가로 표시한다. 파싱 실패도 마찬가지다. 틀린 계보를 보여주는 것보다
모른다고 말하는 것이 낫다.
"""

from __future__ import annotations

import re
import threading
from typing import Any

from .config import DBT_DIR, DBT_PROJECT_NAME, MANIFEST_PATH
from . import manifest

_lock = threading.Lock()
_cache: dict[str, Any] = {"fp": None, "data": None}

_RE_CONFIG = re.compile(r"\{\{-?\s*config\(.*?\}\}", re.S)
_RE_INCR = re.compile(r"\{%-?\s*if\s+is_incremental\(\)\s*-?%\}.*?\{%-?\s*endif\s*-?%\}", re.S)
_RE_REF = re.compile(r"\{\{-?\s*ref\(\s*['\"]([^'\"]+)['\"]\s*\)\s*-?\}\}")
_RE_SOURCE = re.compile(r"\{\{-?\s*source\(\s*['\"][^'\"]+['\"]\s*,\s*['\"]([^'\"]+)['\"]\s*\)\s*-?\}\}")
_RE_THIS = re.compile(r"\{\{-?\s*this\s*-?\}\}")
_RE_VAR = re.compile(r"\{\{-?\s*var\(\s*['\"][^'\"]+['\"][^}]*\)\s*-?\}\}")
_RE_JINJA = re.compile(r"\{\{|\{%")


def _substitute(raw: str, entry: dict[str, Any],
                phys_of: dict[str, str]) -> tuple[str | None, str | None]:
    """Jinja 를 걷어내 순수 SQL 로 만든다. 실패하면 (None, 사유)."""
    s = _RE_CONFIG.sub("", raw)
    s = _RE_INCR.sub("", s)

    missing: list[str] = []

    def by_name(m: re.Match) -> str:
        name = m.group(1)
        if name not in phys_of:
            missing.append(name)
            return name
        return phys_of[name]

    s = _RE_REF.sub(by_name, s)
    s = _RE_SOURCE.sub(by_name, s)
    s = _RE_THIS.sub(entry["phys"], s)
    s = _RE_VAR.sub("null", s)

    if missing:
        return None, f"{missing[0]} 참조를 찾을 수 없습니다."
    if _RE_JINJA.search(s):
        # 어떤 매크로인지 첫 조각을 사유에 남긴다 — 화면에서 원인을 알 수 있게.
        frag = s[_RE_JINJA.search(s).start():][:40].split("\n")[0]
        return None, f"치환할 수 없는 Jinja 구문이 있습니다: {frag}…"
    return s, None


def _compiled(entry: dict[str, Any]) -> str | None:
    """dbt 가 이미 만들어 둔 «Jinja 가 다 풀린» SQL. 없으면 None.

    dbt 는 build/run 때마다 target/compiled/ 에 완성된 SQL 을 남긴다. 매크로도
    루프도 전부 펼쳐진, dbt 가 실제로 실행한 바로 그 문장이다. 그것을 읽으면
    치환을 흉내 낼 필요가 없다 — 추측이 아니라 dbt 의 답을 그대로 쓰는 것이다.

    그렇다고 dbt compile 을 부르지는 않는다(모듈 첫머리의 이유 그대로 15초가 든다).
    **있으면 쓰고 없으면 직접 치환한다.** 한 번도 빌드하지 않은 모델은 여전히
    치환 규칙으로 처리되고, 매크로가 남으면 확인 불가로 표시된다.

    원본보다 오래된 산출물은 쓰지 않는다. SQL 을 고치고 아직 빌드하지 않았다면
    컴파일본은 «지금 파일» 이 아니어서, 그대로 쓰면 화면이 옛 계보를 보여 준다.
    """
    path = entry.get("path") or ""
    if not path:
        return None
    comp = DBT_DIR / "target" / "compiled" / DBT_PROJECT_NAME / path
    try:
        src = (DBT_DIR / path).stat().st_mtime_ns
        if comp.stat().st_mtime_ns < src:
            return None
        return comp.read_text()
    except OSError:
        return None


def _fingerprint() -> Any:
    try:
        st = MANIFEST_PATH.stat()
        return (st.st_mtime_ns, st.st_size)
    except OSError:
        return None


def compute() -> dict[str, Any]:
    """전체 컬럼 계보. manifest 가 바뀔 때까지 캐시된다."""
    fp = _fingerprint()
    with _lock:
        if _cache["data"] is not None and _cache["fp"] == fp:
            return _cache["data"]

    data = _build()
    with _lock:
        _cache.update(fp=fp, data=data)
    return data


def invalidate() -> None:
    with _lock:
        _cache.update(fp=None, data=None)


def _build() -> dict[str, Any]:
    import sqlglot
    from sqlglot import exp
    from sqlglot.lineage import lineage as sg_lineage

    entries = manifest.all_entries()
    phys_of = {e["id"]: e["phys"] for e in entries.values()}
    id_by_phys = {e["phys"].lower(): e["id"] for e in entries.values()}

    # ── 준비 1) 모델 SQL 을 미리 치환해 둔다(스키마 보강에 필요하다)
    prepared: dict[str, tuple[str | None, str | None]] = {}
    for e in entries.values():
        if e["dbt_type"] != "model":
            continue
        # dbt 가 펼쳐 둔 SQL 이 있으면 그것이 가장 정확하다. ref/source 는 이미
        # 물리 이름으로 바뀌어 있으므로 치환할 것이 남지 않는다.
        done = _compiled(e)
        if done is not None:
            prepared[e["id"]] = (done, None)
            continue
        try:
            raw = (DBT_DIR / e["path"]).read_text()
        except OSError:
            prepared[e["id"]] = (None, "SQL 파일을 읽을 수 없습니다.")
            continue
        prepared[e["id"]] = _substitute(raw, e, phys_of)

    # ── 준비 2) 컬럼을 모르는 모델은 SQL 의 출력 이름으로 채운다.
    #
    # yml 에 컬럼을 안 적었고 `dbt docs generate` 도 아직 안 돈 모델은 manifest 에
    # 컬럼이 없다. 그 상태로 두면 스키마에 «컬럼 0개 테이블»이 생기는데,
    # sqlglot 은 그런 스키마를 통째로 거부한다(SchemaError: must have at least one
    # column). 모델 하나 때문에 전체 컬럼 계보가 죽으므로 반드시 메운다.
    # **일부만 문서화한 모델이 더 위험하다.** manifest 의 cols 에는 yml 에 적은 컬럼만
    # 들어 있다. 컬럼이 하나도 없으면 여기서 채우지만, 18개 중 5개만 적어 둔 모델은
    # 「컬럼을 아는 테이블」로 보여서 그대로 스키마가 된다. 그러면 그 모델을 참조하는
    # 다음 모델에서 sqlglot 이 `Unknown column: sigungu_name` 으로 멈추고,
    # **그 모델의 컬럼 계보가 통째로 사라진다** — 원인은 두 단계 위의 yml 인데
    # 화면에는 아래 모델이 「확인 불가」로 뜨므로 이유를 찾기 어렵다.
    #
    # 그래서 문서화 여부와 무관하게 SQL 의 출력 이름을 항상 합친다. 라벨·타입은
    # 문서화된 쪽이 이기고, 문서에 없는 컬럼은 이름만 채워 스키마를 완성한다.
    derived: dict[str, list[list[str]]] = {}
    for e in entries.values():
        if e["dbt_type"] != "model":
            continue
        sql, _why = prepared.get(e["id"], (None, None))
        if not sql:
            continue
        try:
            sel = sqlglot.parse_one(sql, dialect="spark").named_selects
        except Exception:      # noqa: BLE001 — 못 읽으면 그냥 비워 둔다
            continue
        known = {c[0] for c in e["cols"]}
        extra = [[c, c, "", "선택"] for c in sel
                 if c and c != "*" and c not in known]
        if extra:
            derived[e["id"]] = list(e["cols"]) + extra

    def cols_of(e: dict[str, Any]) -> list[list[str]]:
        return derived.get(e["id"]) or e["cols"]

    # sqlglot 이 select * 와 무접두 컬럼을 풀려면 스키마가 필요하다.
    # 컬럼을 끝내 모르는 테이블은 아예 넣지 않는다 — 빈 항목이 스키마를 무효화한다.
    schema: dict[str, dict[str, dict[str, str]]] = {}
    for e in entries.values():
        parts = e["phys"].split(".")
        cols = cols_of(e)
        if len(parts) != 2 or not cols:
            continue
        sch, tbl = parts
        schema.setdefault(sch, {})[tbl] = {
            c[0]: (c[2] or "string").lower() for c in cols}

    nodes: list[dict[str, Any]] = []
    col_edges: list[dict[str, Any]] = []
    transforms: dict[str, dict[str, Any]] = {}
    seen_edges: set[tuple[str, str, str, str]] = set()

    # 계보 상자의 구분 라벨도 카탈로그와 같아야 한다 — DATA MART 로 지정된
    # 모델은 계보에서도 마트로 보인다. 상태 하나가 두 화면에서 갈리면
    # 「이게 분석에 쓰이는 데이터인가」를 화면마다 다시 확인해야 한다.
    from . import store as _store
    marts = _store.marts()

    for e in entries.values():
        is_mart = e["id"] in marts
        node = {
            "id": e["id"], "name": e["name"], "phys": e["phys"],
            "kind": e["kind"],
            "group": "DATA MART" if is_mart else e["group"],
            "baseGroup": e["group"], "isMart": is_mart, "dbtType": e["dbt_type"],
            "cols": [{"col": c[0], "label": c[1], "type": c[2],
                      "tx": False, "status": "ok"} for c in cols_of(e)],
            "lineageStatus": "ok", "reason": None,
        }
        nodes.append(node)

        if e["dbt_type"] != "model":
            continue                       # seed·source 는 계보의 시작점이다

        s, why = prepared.get(e["id"], (None, "SQL 을 준비하지 못했습니다."))
        if s is None:
            node.update(lineageStatus="unknown", reason=why)
            for c in node["cols"]:
                c["status"] = "unknown"
            continue

        try:
            parsed = sqlglot.parse_one(s, dialect="spark")
            if not isinstance(parsed, (exp.Select, exp.Union)):
                raise ValueError("SELECT 문이 아닙니다.")
        except Exception as ex:      # noqa: BLE001 — 파싱 실패 = 확인 불가
            node.update(lineageStatus="unknown",
                        reason=f"SQL 을 해석하지 못했습니다: {str(ex)[:120]}")
            for c in node["cols"]:
                c["status"] = "unknown"
            continue

        for c in node["cols"]:
            try:
                ln = sg_lineage(c["col"], s, schema=schema, dialect="spark")
            except Exception:      # noqa: BLE001 — 컬럼 하나만 확인 불가로
                c["status"] = "unknown"
                continue

            inputs: list[dict[str, str]] = []
            tx_sql: str | None = None
            for n in ln.walk():
                x = n.expression
                if isinstance(x, exp.Table):
                    src_col = n.name.split(".")[-1]
                    if src_col == "*":
                        continue           # count(*) 류 — 특정 컬럼이 아니다
                    src_phys = f"{x.db}.{x.name}".lower() if x.db else x.name.lower()
                    src_id = id_by_phys.get(src_phys)
                    if src_id and src_id != e["id"]:
                        inputs.append({"id": src_id, "col": src_col})
                elif tx_sql is None and isinstance(x, exp.Alias) \
                        and not isinstance(x.this, exp.Column):
                    # 가장 바깥의 «계산이 실제로 일어난» 식 하나만 기록한다.
                    tx_sql = x.this.sql(dialect="spark", pretty=False)

            uniq: list[dict[str, str]] = []
            for i in inputs:
                if i not in uniq:
                    uniq.append(i)

            if tx_sql:
                c["tx"] = True
                transforms[f"{e['id']}.{c['col']}"] = {
                    "sql": tx_sql, "inputs": uniq}
            for i in uniq:
                key = (i["id"], i["col"], e["id"], c["col"])
                if key in seen_edges:
                    continue
                seen_edges.add(key)
                col_edges.append({
                    "fromId": i["id"], "fromCol": i["col"],
                    "toId": e["id"], "toCol": c["col"],
                    "kind": "transform" if tx_sql else "copy"})

    # 파싱은 됐는데 컬럼이 하나도 안 풀린 모델은 «계보 확인 불가»로 올린다.
    # 노드가 ok 인 채로 컬럼만 조용히 unknown 이면 화면에 아무 표시가 안 나서,
    # 계보가 끊긴 것을 «변환이 없는 모델» 로 오해하게 된다.
    for node in nodes:
        if node["lineageStatus"] != "ok" or node["dbtType"] != "model":
            continue
        cs = node["cols"]
        if cs and all(c["status"] == "unknown" for c in cs):
            node.update(lineageStatus="unknown",
                        reason="이 모델의 컬럼 계보를 하나도 확인하지 못했습니다.")

    model_edges = [{"from": up, "to": e["id"]}
                   for e in entries.values() for up in e["upstream"]]

    return {"nodes": nodes, "modelEdges": model_edges,
            "columnEdges": col_edges, "transforms": transforms}
