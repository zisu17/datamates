"""분석 API — 화면 A(목록)·B(대시보드 보기)가 쓴다.

Superset 이 이미 아는 것(대시보드·차트 목록)은 여기서 그대로 중계한다.
Superset 이 **모르는 것**을 얹는 게 이 라우터의 존재 이유다 —
어느 대시보드가 어느 데이터 모델을 쓰는지, 그 모델이 언제 적재됐는지.
그 연결이 없으면 Superset 은 그냥 블랙박스이고, 분석과 카탈로그가 두 제품이 된다.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from .. import manifest, store, warehouse
from ..analytics import client
from ..analytics import query as qbuild
from ..analytics import sync as ds_sync
from ..config import SUPERSET_PREFIX
from ..errors import ApiError

router = APIRouter(prefix="/analytics", tags=["analytics"])


def _model_index() -> tuple[dict[int, dict[str, Any]], dict[str, dict[str, Any]]]:
    """(데이터셋id → 모델, 모델id → 모델).

    P3 부터 **매핑 테이블로 잇는다.** P2 까지는 물리명 문자열로 맞췄는데,
    그 방식은 모델의 물리 위치가 바뀌는 순간 조용히 끊긴다 —
    화면에는 「모델 연결 없음」으로만 나와서 원인을 알기 어렵다.

    매핑에 없는 데이터셋은 이어 붙이지 않는다. 그게 「플랫폼이 만들지 않은
    데이터셋」이라는 사실 자체가 드러나야 하는 정보다(설계서 리스크 6).
    """
    by_id = {e["id"]: e for e in manifest.all_entries().values()}
    by_ds = {ds_id: by_id[mid]
             for ds_id, mid in store.ds_by_dataset().items() if mid in by_id}
    return by_ds, by_id


def _load_time_sql(where_phys: str | None = None) -> str:
    """테이블별 마지막 적재 시각 SQL — DuckLake 메타데이터를 한 번에 훑는다.

    Iceberg 시절에는 테이블마다 iceberg_snapshots(...) 를 부르고 UNION ALL 로
    이어 붙였다. DuckLake 는 스냅샷·파일·테이블·스키마가 카탈로그(Postgres)의
    표라서, 조인 한 번이면 전체 테이블의 최신 적재 시각이 한 결과로 나온다.
    카탈로그가 커져도 왕복이 늘지 않는다.

    시간대 처리도 단순해졌다 — snapshot_time 이 이미 timestamptz 라서
    Iceberg 의 `AT TIME ZONE 'UTC'` 보정이 필요 없다.

    end_snapshot IS NULL 은 «지금 살아 있는 판» 이라는 뜻이다. 빼면 이름이 바뀌거나
    지워진 옛 항목까지 섞여 든다.
    """
    a = warehouse.ALIAS
    # DuckLake 는 ATTACH 할 때 메타데이터 표를 별도 카탈로그에 붙인다 —
    # 데이터가 있는 `ice` 가 아니라 `__ducklake_metadata_ice` 다.
    meta = f"__ducklake_metadata_{a}"
    where = f"WHERE s.schema_name || '.' || t.table_name = '{where_phys}'" if where_phys else ""
    return f"""
        SELECT s.schema_name || '.' || t.table_name AS phys,
               max(sn.snapshot_time)                AS t
        FROM {meta}.ducklake_data_file df
        JOIN {meta}.ducklake_table  t ON t.table_id  = df.table_id  AND t.end_snapshot IS NULL
        JOIN {meta}.ducklake_schema s ON s.schema_id = t.schema_id  AND s.end_snapshot IS NULL
        JOIN {a}.snapshots()       sn ON sn.snapshot_id = df.begin_snapshot
        {where}
        GROUP BY 1"""


def _last_load(phys: str) -> str:
    """그 테이블이 마지막으로 적재된 시각 — DuckLake 스냅샷 타임스탬프.

    Superset 은 이걸 모른다. 「이 숫자가 언제 것인가」가 대시보드를 보는 사람의
    첫 질문이므로 화면 B 의 제목줄에 붙인다.
    조회에 실패하면 빈 문자열이다 — 있으면 좋고 없어도 되는 정보다.
    """
    try:
        out = warehouse.query(_load_time_sql(where_phys=phys))
        rows = out["rows"]
        return str(rows[0][1]) if rows and rows[0][1] else ""
    except Exception:      # noqa: BLE001
        return ""


def _load_times() -> dict[str, str]:
    """모델·원천별 마지막 적재 시각을 **한 번의 질의로** 모아 온다.

    테이블마다 _last_load 를 부르면 카탈로그 크기만큼 왕복이 늘어난다. 목록 화면은
    대시보드마다 여러 모델을 보여 주므로 그 왕복이 그대로 화면 대기 시간이 된다.
    실패한 테이블은 그냥 빠진다 — 적재 시각은 있으면 좋고 없어도 되는 정보다.
    """
    entries = [(mid, e["phys"]) for mid, e in manifest.all_entries().items()
               if e.get("phys")]
    if not entries:
        return {}
    try:
        out = warehouse.query(_load_time_sql())
    except Exception:      # noqa: BLE001 — 통째로 실패하면 하나씩 물어본다
        return {mid: _last_load(phys) for mid, phys in entries}
    # 결과는 물리명 기준이라 모델 id 로 되돌린다. 카탈로그에 있어도 manifest 에
    # 없는 표(수집 raw, elementary 등)는 여기서 자연히 빠진다.
    by_phys = {r[0]: (str(r[1]) if r[1] else "") for r in out["rows"]}
    return {mid: by_phys[phys] for mid, phys in entries if phys in by_phys}


def _upstream_load(model_id: str, times: dict[str, str],
                   _seen: set[str] | None = None) -> str:
    """이 모델의 상류 전체에서 가장 최근 적재 시각.

    직속 상류만 보면 안 된다. 원천이 갱신됐는데 중간 모델도 함께 밀려 있으면
    직속 비교로는 「같다」가 나와 갱신 필요를 놓친다. 뿌리까지 훑는다.
    """
    seen = _seen if _seen is not None else set()
    if model_id in seen:
        return ""                       # 순환은 dbt 가 막지만 방어해 둔다
    seen.add(model_id)
    entries = manifest.all_entries()
    best = ""
    for up in (entries.get(model_id) or {}).get("upstream") or []:
        best = max(best, times.get(up, ""), _upstream_load(up, times, seen))
    return best


def _dataset_models(datasets: list[dict[str, Any]],
                    by_ds: dict[int, dict[str, Any]],
                    *, times: dict[str, str] | None = None) -> list[dict[str, Any]]:
    """Superset 데이터셋 목록 → 플랫폼 모델 목록 (중복 제거, 순서 유지).

    매핑에 없는 데이터셋은 `unmapped` 로 센다 — 「플랫폼이 만들지 않은 것이
    섞여 있다」를 화면이 드러낼 수 있어야 한다.

    times 를 주면 «상류가 더 최신인가» 를 함께 판정한다. 그 상태가 화면에
    「마트 데이터 갱신 필요」로 뜬다 — 숫자는 그려지는데 원천보다 오래된 것이
    가장 조용한 실패이므로, 조용히 두지 않는다.
    """
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for d in datasets:
        m = by_ds.get(int(d.get("id") or 0))
        if not m or m["id"] in seen:
            continue
        seen.add(m["id"])
        item = {"id": m["id"], "name": m.get("name"), "phys": m.get("phys"),
                "group": m.get("group"), "kind": m.get("kind")}
        if times is not None:
            mine = times.get(m["id"], "")
            up = _upstream_load(m["id"], times)
            item["lastLoad"] = mine
            item["upstreamLoad"] = up
            # 둘 다 읽혔을 때만 판정한다. 한쪽이 비면 «모른다» 이지 «오래됐다» 가 아니다.
            item["stale"] = bool(mine and up and up > mine)
        out.append(item)
    return out


def _unmapped(datasets: list[dict[str, Any]], by_ds: dict[int, dict[str, Any]]) -> int:
    return sum(1 for d in datasets if int(d.get("id") or 0) not in by_ds)


@router.get("/status")
def status() -> dict[str, Any]:
    """분석 엔진이 붙는지. 화면이 메뉴를 흐리게 처리할지 결정하는 데 쓴다."""
    h = client.health()
    return {"ok": h["ok"], "prefix": SUPERSET_PREFIX,
            **({"error": h["error"]} if "error" in h else {})}


@router.get("/datasets")
def datasets() -> dict[str, Any]:
    """데이터 모델 ↔ Superset 데이터셋 매핑 현황.

    화면이 「분석에서 쓸 수 있는 모델」을 보여주고, 동기화가 밀렸는지 드러낸다.
    """
    mapped = store.ds_all()
    entries = manifest.all_entries()
    items = []
    for mid, e in entries.items():
        row = mapped.get(mid)
        items.append({"modelId": mid, "name": e.get("name"), "phys": e.get("phys"),
                      "group": e.get("group"),
                      "datasetId": row["datasetId"] if row else None,
                      "state": row["state"] if row else "missing"})
    orphans = [{"modelId": mid, "datasetId": r["datasetId"], "phys": r["phys"]}
               for mid, r in mapped.items() if mid not in entries]
    return {"items": items, "total": len(items),
            "missing": sum(1 for i in items if i["state"] == "missing"),
            "orphans": orphans}


@router.post("/datasets:sync")
def datasets_sync() -> dict[str, Any]:
    """카탈로그를 Superset 데이터셋에 반영한다.

    기동 때 자동으로 한 번 돌지만, 모델을 추가한 직후 화면에서 바로 쓰려면
    이 버튼이 필요하다. 멱등이므로 몇 번 눌러도 안전하다.
    """
    return ds_sync.sync_all()


def _who(o: dict[str, Any]) -> str:
    """작성자 표기. 지금은 서비스 계정 하나뿐이라 전부 같은 이름이 나온다 —
    사용자 신원이 붙으면 여기가 그 자리다."""
    p = o.get("changed_by") or o.get("created_by") or {}
    parts = [(p.get("first_name") or "").strip(), (p.get("last_name") or "").strip()]
    return " ".join(x for x in parts if x) or "—"


@router.get("/assets")
def assets() -> dict[str, Any]:
    """첫 화면이 한 번에 받는 것 — 분석 자산 목록.

    화면은 Superset 의 객체 종류(Dashboard · Chart · Dataset)를 앞세우지 않는다.
    사용자가 아는 단위는 두 개다: **대시보드** 와 **분석**.
    설명은 «어느 데이터로 만든 것인가» 로 채운다 — Superset 대시보드에는 설명
    필드가 없고, 사용자에게 실제로 필요한 정보는 그것이다.
    """
    by_ds, _ = _model_index()
    times = _load_times()

    dash_raw = client.dashboards()
    chart_raw = client.charts()
    fav_d = client.favorites("dashboard", [d["id"] for d in dash_raw])
    fav_c = client.favorites("chart", [c["id"] for c in chart_raw])

    dashboards_out = []
    for d in dash_raw:
        try:
            ds = client.dashboard_datasets(d["id"])
        except Exception:      # noqa: BLE001 — 목록이 통째로 죽는 것보다 낫다
            ds = []
        models = _dataset_models(ds, by_ds, times=times)
        stale = [m["name"] for m in models if m.get("stale")]
        dashboards_out.append({
            "kind": "dashboard", "id": d["id"],
            "name": d.get("dashboard_title") or f"대시보드 {d['id']}",
            "desc": ", ".join(m["name"] for m in models) or "연결된 데이터 없음",
            "changed": d.get("changed_on_delta_humanized"),
            "changedAt": d.get("changed_on_utc"),
            "author": _who(d),
            "favorite": bool(fav_d.get(d["id"])),
            "models": models,
            "unmappedDatasets": _unmapped(ds, by_ds),
            "dataUpdated": max((m.get("lastLoad") or "" for m in models), default=""),
            # 상류가 더 최신인 모델. 하나라도 있으면 화면이 「마트 데이터 갱신 필요」
            # 를 띄운다 — 수집은 돌았는데 가공이 안 돈 상태다.
            "staleModels": stale,
            "needsRefresh": bool(stale),
            "editUrl": f"{SUPERSET_PREFIX}/dashboard/{d['id']}/",
        })

    charts_out = []
    for c in chart_raw:
        m = by_ds.get(int(c.get("datasource_id") or 0))
        charts_out.append({
            "kind": "chart", "id": c["id"],
            "name": c.get("slice_name") or f"분석 {c['id']}",
            "desc": (c.get("description") or "").strip()
                    or (m["name"] if m else "연결된 데이터 없음"),
            "changed": c.get("changed_on_delta_humanized"),
            "changedAt": c.get("changed_on_utc"),
            "author": _who(c),
            "favorite": bool(fav_c.get(c["id"])),
            "modelId": m["id"] if m else None,
        })

    # 최근 사용한 분석 — **대시보드만** 담는다. 층을 섞지 않는다.
    #
    # 전에는 대시보드와 그 안의 분석을 한데 섞어 수정 시각 순으로 줬다. 그러면
    # 「전세가율 · 갭 리스크」와 그 대시보드 안의 「분양권 지역별 추이」가 같은
    # 층으로 나란히 놓인다 — 상위와 하위가 같은 목록에 있으니 같은 내용이 두 번
    # 보이고, 무엇을 고르는 목록인지 흐려진다.
    #
    # 목록 화면에서 고르는 단위는 대시보드 하나다. 아래 「전체 대시보드」와 같은
    # 층이고, 눌렀을 때 열리는 것도 대시보드 탭이다. 분석 하나를 눌러도 결국
    # 그것이 올라간 대시보드를 열 뿐이므로, 하위를 따로 늘어놓을 이유가 없다.
    #
    # 곁따라 해결되는 것 — 대시보드를 지워도 그 안의 분석은 남는데(같은 분석이
    # 다른 대시보드에도 올라가 있을 수 있어 Superset 이 함께 지우지 않는다),
    # 예전에는 그 남은 분석이 최근 목록 맨 위에 계속 떴다. 열 대시보드가 없어
    # 눌러도 반응이 없었다.
    recent = sorted(dashboards_out,
                    key=lambda x: x.get("changedAt") or "", reverse=True)[:6]
    return {"recent": recent, "dashboards": dashboards_out, "charts": charts_out,
            # 공유 개념은 사용자 신원이 있어야 성립한다. 지금은 비어 있고,
            # 화면이 그 사실을 설명한다 — 목록을 감추면 왜 없는지 알 수 없다.
            "shared": [], "sharingAvailable": False}


@router.post("/assets/{kind}/{obj_id}/favorite")
def toggle_favorite(kind: str, obj_id: int, body: dict[str, Any]) -> dict[str, Any]:
    if kind not in ("dashboard", "chart"):
        raise ApiError("INVALID_ARGUMENT", f"{kind} 는 지원하지 않습니다.")
    on = bool(body.get("on"))
    client.set_favorite(kind, obj_id, on)
    return {"kind": kind, "id": obj_id, "favorite": on}


@router.delete("/assets/{kind}/{obj_id}")
def delete_asset(kind: str, obj_id: int) -> dict[str, Any]:
    """더보기 메뉴의 삭제. 데이터는 건드리지 않는다 — 분석 자산만 지운다."""
    if kind not in ("dashboard", "chart"):
        raise ApiError("INVALID_ARGUMENT", f"{kind} 는 지원하지 않습니다.")
    client.api("DELETE", f"/api/v1/{kind}/{obj_id}")
    return {"deleted": True, "kind": kind, "id": obj_id}


# 시각화 종류를 화면 어휘로 되돌린다. 화면은 Superset viz_type 을 모른다.
_VIZ_BACK = {v["superset"]: k for k, v in qbuild.VIZ.items()}


@router.get("/dashboards/{dash_id}/charts")
def dashboard_charts(dash_id: int) -> dict[str, Any]:
    """대시보드의 차트 + 각 차트의 데이터.

    **그림은 플랫폼이 그린다.** 그래서 iframe 이 없고, 스크롤도 한 겹이다.
    저장된 차트를 Superset 이 실행해 주고(query_context) 결과만 받아 온다 —
    스펙을 따로 저장하지 않으므로 원천이 하나로 유지된다.
    """
    # 데이터셋 → 데이터 모델. 시간 컬럼 포맷을 모델 정의에서 가져오기 위해 필요하다.
    by_ds = {r["datasetId"]: mid for mid, r in store.ds_all().items()}
    items = []
    for c in client.dashboard_charts(dash_id):
        cid = c.get("id")
        # viz_type·질의 조건이 모두 form_data 안에 있다. 바깥에서 찾으면 못 찾는다.
        fd = c.get("form_data") or {}
        item: dict[str, Any] = {
            "id": cid,
            "name": c.get("slice_name") or fd.get("slice_name") or f"분석 {cid}",
            "viz": _VIZ_BACK.get(fd.get("viz_type") or "", "table"),
            "columns": [], "rows": [], "error": "",
        }
        try:
            # form_data 로 매번 질의를 만든다. 차트에 저장된 질의 맥락에 의존하지
            # 않는 이유는, 자산을 다시 등록하면 차트가 새로 만들어져(id 가 바뀐다)
            # 미리 채워 둔 맥락이 사라지기 때문이다. 사용자 차트를 고치지도 않는다.
            src = str(fd.get("datasource") or "")
            ds_id = int(src.split("__")[0]) if src.split("__")[0].isdigit() else 0
            if not ds_id:
                raise ValueError("연결된 데이터를 찾지 못했습니다.")
            # run_query 는 이미 columns/rows 로 정규화해서 준다.
            out = client.run_query(qbuild.query_context_from_params(fd, ds_id))
            # 시간 컬럼은 서버가 맞춘다. 화면이 epoch 밀리초를 추측하게 두면
            # 차트마다 다르게 처리되기 시작한다.
            mid = by_ds.get(ds_id)
            temporal = {}
            if mid:
                info = build_columns(mid)
                temporal = {c["name"]: c["type"] for c in info["columns"]
                            if c["role"] == "time"}
            item["columns"] = out["columns"]
            item["rows"] = _fmt_temporal(out["rows"], out["columns"], temporal)
        except ApiError as e:
            # 한 분석이 실패해도 대시보드 전체가 죽지 않게 한다.
            item["error"] = e.message
        except Exception as e:      # noqa: BLE001
            item["error"] = str(e)[:200]
        items.append(item)
    return {"dashboardId": dash_id, "items": items, "total": len(items)}


@router.get("/dashboards/{dash_id}/embed")
def dashboard_embed(dash_id: int) -> dict[str, Any]:
    """화면 B 가 iframe 을 띄우기 전에 부르는 것 — uuid 하나."""
    return {"id": dash_id, "uuid": client.embed_uuid(dash_id)}


@router.post("/dashboards/{dash_id}/guest-token")
def dashboard_guest_token(dash_id: int) -> dict[str, Any]:
    """게스트 토큰 발급. SDK 가 만료(5분) 전에 다시 부른다.

    서버가 발급하는 이유는 하나다 — 그러지 않으면 서비스 계정 자격증명이
    브라우저로 나가야 한다. 화면은 이 엔드포인트만 알면 된다.
    """
    uuid = client.embed_uuid(dash_id)
    return {"token": client.guest_token(uuid), "uuid": uuid}


# ─────────────────────────────────────────────────────────────
# 화면 C — 분석 만들기
# ─────────────────────────────────────────────────────────────
#
# 화면은 Superset 의 어휘를 모른다. 모델·컬럼·차원·측정값·필터만 안다.
# 번역은 analytics/query.py 가 한다.


@router.get("/build/options")
def build_options() -> dict[str, Any]:
    """화면 C 가 처음 한 번 받는 것 — 고를 수 있는 것들의 목록.

    시각화·집계·연산자를 서버가 주는 이유는 규칙이 한 곳에만 있어야 하기 때문이다.
    화면에 하드코딩하면 서버 검증과 어긋나는 순간 사용자가 이유를 알 수 없게 된다.

    **고를 수 있는 것은 DATA MART 뿐이다.** SOURCE 나 중간 데이터 모델을 열어
    두면 분석마다 다른 가공 단계를 보게 되고, 같은 지표가 화면마다 다른 값으로
    나온다. 무엇을 분석에 내보낼지는 데이터 모델 화면에서 «마트로 지정» 하는
    한 번의 결정으로 정한다.
    """
    mapped = store.ds_all()
    marts = store.marts()
    models = []
    for mid, e in manifest.all_entries().items():
        if mid not in marts:
            continue          # 마트가 아닌 모델은 분석에서 고를 수 없다
        if mid not in mapped:
            continue          # 동기화 안 된 모델은 고를 수 없다
        models.append({
            "id": mid, "name": e.get("name"), "phys": e.get("phys"),
            "group": "DATA MART", "kind": e.get("kind"),
            "desc": (e.get("desc") or "").strip(),
            # 목록 화면의 「분석 대상 데이터」 표가 쓴다. 행 수를 주지 않는 이유는
            # 마트마다 count 질의를 돌려야 해서다 — 목록 한 번에 마트 수만큼
            # 웨어하우스 왕복이 생긴다. 컬럼 수는 manifest 에 이미 있다.
            "cols": len(e.get("cols") or []),
            # 화면이 「엔진에서 직접 만들기」로 넘어갈 때 쓴다. 마법사가 못 그리는
            # 시각화를 같은 데이터로 이어서 만들 수 있게 하는 통로다.
            "datasetId": mapped[mid]["datasetId"],
        })
    models.sort(key=lambda m: m["name"] or "")
    return {
        "models": models,
        "martCount": len(marts),
        "viz": [{"key": k, "label": v["label"],
                 "dims": list(v["dims"]), "metrics": list(v["metrics"])}
                for k, v in qbuild.VIZ.items()],
        "agg": [{"key": k, "label": v} for k, v in qbuild.AGG.items()],
        "ops": [{"key": k, "label": v,
                 "needsValue": k not in qbuild.NO_VALUE_OPS}
                for k, v in qbuild.OPS.items()],
    }


@router.get("/build/models/{model_id}/columns")
def build_columns(model_id: str) -> dict[str, Any]:
    """그 모델의 컬럼. 표시 이름은 dbt meta.label, 없으면 컬럼명이다.

    `role` 은 화면이 차원·측정값 후보를 나누는 힌트다 — 강제하지 않는다.
    숫자만 측정값이 될 수 있다고 막으면 「건수 세기」 같은 쓰임을 못 한다.
    """
    e = manifest.all_entries().get(model_id)
    if not e:
        return {"modelId": model_id, "columns": [], "known": False}

    ds_id = store.ds_all().get(model_id, {}).get("datasetId")

    # 타입은 **Superset 데이터셋** 에서 가져온다.
    #
    # manifest 의 컬럼 타입은 dbt catalog(dbt docs generate)에서 오는데 그게 없으면
    # 비어 있다. 실제로 이 프로젝트의 모델 대부분이 비어 있었고, 그러면 화면이
    # 차원·측정값 후보를 나눌 수 없다. 데이터셋 쪽은 reflection 으로 채워져 있고
    # (P3 의 DESCRIBE 덕분에) Superset 이 질의할 때 쓰는 것과 같은 타입이다.
    types: dict[str, str] = {}
    if ds_id:
        try:
            d = client.api("GET", f"/api/v1/dataset/{ds_id}")["result"]
            types = {c["column_name"]: (c.get("type") or "")
                     for c in d.get("columns") or []}
        except Exception:      # noqa: BLE001 — 타입은 힌트다. 없어도 고를 수 있다.
            types = {}

    labels = {c[0]: (c[1] or c[0]) for c in (e.get("cols") or [])}
    descs = e.get("col_desc") or {}

    # 존재 여부의 기준은 데이터셋이다 — manifest 에는 문서화된 컬럼만 있다.
    # 순서는 manifest(= schema.yml 작성 순서)를 앞세우고 나머지를 뒤에 붙인다.
    documented = [c[0] for c in (e.get("cols") or []) if c[0] in types]
    order = documented + [n for n in types if n not in set(documented)]
    if not order:
        order = [c[0] for c in (e.get("cols") or [])]

    cols = []
    for name in order:
        ctype = types.get(name, "")
        t = ctype.upper()
        numeric = any(k in t for k in
                      ("INT", "DEC", "NUMER", "DOUBLE", "FLOAT", "REAL"))
        temporal = any(k in t for k in ("DATE", "TIME"))
        cols.append({"name": name, "label": labels.get(name, name), "type": ctype,
                     "desc": descs.get(name, ""),
                     # 힌트일 뿐이다. 숫자만 측정값이 될 수 있다고 막으면
                     # 「건수 세기」 같은 쓰임을 못 한다.
                     "role": "measure" if numeric else
                             "time" if temporal else "dimension"})
    return {"modelId": model_id, "name": e.get("name"),
            "columns": cols, "known": True, "datasetId": ds_id}


def _fmt_temporal(rows: list[list[Any]], cols: list[str],
                  temporal: dict[str, str]) -> list[list[Any]]:
    """시간 컬럼을 사람이 읽는 문자열로 바꾼다.

    Superset 은 시간 컬럼을 epoch 밀리초 숫자로 준다(1783036800000.0).
    화면이 그걸 추측해서 고치게 두면 컬럼마다 다르게 처리되기 시작한다 —
    서버가 한 번에 맞춘다. 시간대는 플랫폼 설정(Asia/Seoul)을 따른다.
    """
    import datetime
    import os
    tz = os.environ.get("DATAMATES_DUCKDB_TIMEZONE", "Asia/Seoul")
    try:
        from zoneinfo import ZoneInfo
        zone = ZoneInfo(tz)
    except Exception:      # noqa: BLE001
        zone = datetime.timezone.utc

    idx = [(i, temporal[c]) for i, c in enumerate(cols) if c in temporal]
    if not idx:
        return rows
    out = []
    for r in rows:
        r = list(r)
        for i, ctype in idx:
            v = r[i]
            if not isinstance(v, (int, float)):
                continue
            # DATE 는 시간대가 없는 값이다. 지역 시간대로 변환하면 UTC 자정이
            # 09:00 으로 밀려 «일자» 가 시각처럼 보인다 — UTC 로 읽어 날짜만 쓴다.
            if "DATE" in ctype.upper() and "TIME" not in ctype.upper():
                d = datetime.datetime.fromtimestamp(v / 1000, tz=datetime.timezone.utc)
                r[i] = d.strftime("%Y-%m-%d")
            else:
                d = datetime.datetime.fromtimestamp(v / 1000, tz=zone)
                r[i] = d.strftime("%Y-%m-%d %H:%M:%S")
        out.append(r)
    return out


@router.post("/build/run")
def build_run(spec: dict[str, Any]) -> dict[str, Any]:
    """분석 실행 — 결과 표를 돌려준다.

    저장과 분리돼 있다. 사용자가 결과를 먼저 보고 저장할지 정한다.
    """
    payload = qbuild.data_payload(spec)
    out = client.run_query(payload)

    # 컬럼 표시 이름과 시간 포맷을 여기서 맞춘다. 화면은 받은 대로 그린다.
    info = build_columns(spec.get("modelId") or "")
    temporal = {c["name"]: c["type"] for c in info["columns"] if c["role"] == "time"}
    labels = {c["name"]: c["label"] for c in info["columns"]}
    rows = _fmt_temporal(out["rows"], out["columns"], temporal)
    headers = [labels.get(c, c) for c in out["columns"]]

    return {**out, "rows": rows, "headers": headers,
            "datasetId": payload["datasource"]["id"]}


@router.post("/build/save")
def build_save(body: dict[str, Any]) -> dict[str, Any]:
    """차트를 저장하고, 원하면 대시보드에 올린다.

    body = { name, spec, dashboardId? , newDashboardTitle? }
    """
    spec = body.get("spec") or {}
    name = (body.get("name") or "").strip()
    if not name:
        raise ApiError("INVALID_ARGUMENT", "차트 이름을 입력해 주세요.")

    params = qbuild.chart_params(spec, name)
    ds_id = qbuild.dataset_id(spec.get("modelId") or "")

    dash_id = body.get("dashboardId")
    title = (body.get("newDashboardTitle") or "").strip()
    if title:
        dash_id = client.create_dashboard(title)

    chart_id = client.create_chart(
        name, ds_id, params, [int(dash_id)] if dash_id else None,
        # 저장된 차트를 나중에 실행할 수 있게 질의 맥락을 함께 넣는다.
        query_context=qbuild.data_payload(spec))
    if dash_id:
        client.place_on_dashboard(int(dash_id), chart_id, name, params["viz_type"])

    return {"chartId": chart_id, "dashboardId": int(dash_id) if dash_id else None,
            "name": name}


def model_analyses(model_id: str) -> dict[str, Any]:
    """이 모델(= DATA MART)을 쓰는 분석 목록.

    DATA MART 지정 해제를 막는 근거이자, 모델 상세의 「데이터 분석에서 사용
    여부」 줄이 쓰는 값이다. 대시보드까지 훑지 않는 이유는 비용이다 —
    대시보드별 데이터셋 조회는 대시보드 수만큼 요청이 나가는데, 이 함수는
    모델을 고를 때마다 불린다. 차트 목록 한 번이면 「몇 개의 분석이 쓰는가」는
    정확히 나온다(사용자가 아는 단위도 분석이다).
    """
    ds = store.ds_all().get(model_id)
    if not ds:
        return {"analyses": [], "dashboards": []}
    ds_id = int(ds["datasetId"])
    out = []
    for c in client.charts():
        if int(c.get("datasource_id") or 0) != ds_id:
            continue
        out.append({"id": c["id"],
                    "name": c.get("slice_name") or f"분석 {c['id']}",
                    "changed": c.get("changed_on_delta_humanized"),
                    "editUrl": f"{SUPERSET_PREFIX}/explore/?slice_id={c['id']}"})
    return {"analyses": out, "dashboards": []}


@router.get("/models/{model_id}/usage")
def model_usage(model_id: str) -> dict[str, Any]:
    """이 모델을 쓰는 대시보드 — 화면 D(분석 사용처)의 뼈대.

    지금은 대시보드 단위까지다. 차트·컬럼 단위는 P5 에서 매핑 테이블을 놓고 채운다.
    """
    by_ds, by_id = _model_index()
    if model_id not in by_id:
        return {"modelId": model_id, "dashboards": [], "known": False}

    used = []
    for d in client.dashboards():
        try:
            ds = client.dashboard_datasets(d["id"])
        except Exception:      # noqa: BLE001
            continue
        if any(m["id"] == model_id for m in _dataset_models(ds, by_ds)):
            used.append({"id": d["id"],
                         "title": d.get("dashboard_title") or f"대시보드 {d['id']}",
                         "changed": d.get("changed_on_delta_humanized")})
    return {"modelId": model_id, "dashboards": used, "known": True}
