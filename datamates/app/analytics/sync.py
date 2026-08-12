"""dbt manifest → Superset 데이터셋 동기화.

**이 모듈이 분석 기능의 카탈로그 원칙을 지킨다.**

BI 도구를 붙일 때 가장 조용히 망가지는 것은 카탈로그가 둘이 되는 것이다.
Superset 은 자기 데이터셋 정의를 갖는데, 사람이 그걸 손으로 만들기 시작하면
플랫폼이 내세운 「관계를 따로 저장하는 곳이 없다」가 그 순간 거짓이 된다.

그래서 데이터셋은 **만들어지는 것이지 작성되는 것이 아니다.**
프록시가 데이터셋 쓰기를 403 으로 막고(analytics/proxy.py 의 READ_ONLY),
만드는 경로는 이 모듈뿐이다. 두 장치가 함께 있어야 원칙이 코드가 된다.

  manifest.all_entries()  →  Superset 데이터셋  →  메타스토어에 매핑 기록
       (단일 원천)              (1:1 대응)          (주소록, 원천이 아님)

매핑을 남기는 이유 — 없으면 물리명으로 매칭해야 하고, 그러면 모델 이름이 바뀌는
순간 연결이 끊긴다. 차트에서 모델로 거슬러 올라가는 것도 이 표가 있어야 한다.
"""

from __future__ import annotations

import logging
from typing import Any

from .. import manifest, store
from ..errors import ApiError
from . import client

logger = logging.getLogger(__name__)

# Superset 이 쓰는 스키마 문자열. P0 에서 확인했다 — 「카탈로그.스키마」 형태다.
# ice 는 warehouse.py 의 ALIAS 이고, superset_config.py 의 ICEBERG_ALIAS 와 같다.
CATALOG = "ice"


def _sup_schema(phys: str) -> tuple[str, str]:
    """analytics.fct_events → ("ice.analytics", "fct_events")."""
    parts = [p for p in phys.split(".") if p]
    if len(parts) != 2:
        raise ApiError("INVALID_ARGUMENT",
                       f"{phys} 는 스키마.테이블 형식이 아닙니다.")
    return f"{CATALOG}.{parts[0]}", parts[1]


def _database_id() -> int:
    """분석용 DuckDB 연결의 id. 없으면 만든다.

    P2 까지는 사람이(스크립트가) 만들었다. 여기서 만들게 두면 설치 직후
    첫 동기화만으로 분석 기능이 준비된다 — 수동 준비 단계가 사라진다.
    """
    from ..config import SUPERSET_PREFIX      # noqa: F401 — 문서용 참조
    name = "Data Mates 웨어하우스"
    import json as _json
    q = _json.dumps({"filters": [
        {"col": "database_name", "opr": "eq", "value": name}]})
    out = client.api("GET", f"/api/v1/database/?q={q}")
    if out and out.get("count"):
        return out["result"][0]["id"]

    out = client.api("POST", "/api/v1/database/", json={
        "database_name": name,
        # 컨테이너 안의 인메모리 DuckDB. 실제 데이터는 접속 훅이 ATTACH 하는
        # Iceberg 카탈로그에 있다 — superset_config.py 참고.
        "sqlalchemy_uri": "duckdb:///:memory:",
        "expose_in_sqllab": True,
        "allow_dml": False,        # 조회 전용 — 쓰기는 dbt 와 Spark 의 일이다
        "cache_timeout": 60,
    })
    return out["id"]


def _find_dataset(db_id: int, schema: str, table: str) -> int | None:
    import json as _json
    q = _json.dumps({"filters": [
        {"col": "table_name", "opr": "eq", "value": table}]})
    out = client.api("GET", f"/api/v1/dataset/?q={q}")
    for d in (out or {}).get("result", []):
        if d.get("schema") == schema and int(d.get("database", {}).get("id", 0) or 0) in (db_id, 0):
            return d["id"]
    return None


def _column_payload(existing: list[dict[str, Any]],
                    entry: dict[str, Any]) -> list[dict[str, Any]] | None:
    """컬럼에 표시 이름과 설명을 얹은 payload. 바꿀 것이 없으면 None.

    Superset 의 데이터셋 PUT 은 columns 를 **컬렉션 교체** 로 다룬다 —
    id 를 함께 보내야 갱신이고, 빠뜨린 컬럼은 삭제된다. 그래서 기존 컬럼 전체를
    id 와 함께 다시 보낸다.

    표시 이름의 출처는 dbt schema.yml 의 `meta.label` 이다(manifest.py 의 규약).
    라벨이 없는 모델은 컬럼명이 그대로 들어오므로 그때는 verbose_name 을 비운다 —
    컬럼명을 표시 이름으로 또 넣으면 Superset 화면에 같은 문자열이 두 번 나온다.
    """
    labels = {c[0]: (c[1] or "") for c in (entry.get("cols") or [])}
    descs = entry.get("col_desc") or {}

    payload, changed = [], False
    for col in existing:
        name = col.get("column_name")
        label = labels.get(name, "")
        want_verbose = label if label and label != name else None
        want_desc = (descs.get(name) or "").strip() or None

        item: dict[str, Any] = {"id": col["id"], "column_name": name}
        # Superset 은 null 로 지우는 것을 받아 준다. 값이 같으면 건드리지 않는다.
        if (col.get("verbose_name") or None) != want_verbose:
            item["verbose_name"] = want_verbose
            changed = True
        if (col.get("description") or None) != want_desc:
            item["description"] = want_desc
            changed = True
        payload.append(item)

    return payload if changed else None


def sync_one(model_id: str, entry: dict[str, Any], db_id: int) -> dict[str, Any]:
    """모델 하나를 데이터셋에 반영한다. 이미 있으면 갱신만 한다."""
    schema, table = _sup_schema(entry["phys"])
    known = store.ds_all().get(model_id)
    ds_id = known["datasetId"] if known else None

    # 매핑이 있어도 Superset 쪽이 지워졌을 수 있다. 있는지 확인한다.
    if ds_id is not None:
        try:
            client.api("GET", f"/api/v1/dataset/{ds_id}")
        except ApiError:
            ds_id = None

    if ds_id is None:
        ds_id = _find_dataset(db_id, schema, table)      # 손으로 만든 것 흡수
        action = "adopted" if ds_id else "created"
    else:
        action = "updated"

    if ds_id is None:
        out = client.api("POST", "/api/v1/dataset/", json={
            "database": db_id, "schema": schema, "table_name": table})
        ds_id = out["id"]

    # 설명·컬럼 라벨을 얹는다.
    detail = client.api("GET", f"/api/v1/dataset/{ds_id}")["result"]
    body: dict[str, Any] = {}
    want_desc = (entry.get("desc") or "").strip()
    if want_desc and (detail.get("description") or "") != want_desc:
        body["description"] = want_desc
    cols = _column_payload(detail.get("columns") or [], entry)
    if cols:
        body["columns"] = cols

    if body:
        client.api("PUT", f"/api/v1/dataset/{ds_id}", json=body)
        if action == "updated":
            action = "relabeled"

    store.ds_set(model_id, ds_id, entry["phys"])
    return {"modelId": model_id, "datasetId": ds_id, "action": action,
            "schema": schema, "table": table,
            "labels": len(body.get("columns") or [])}


def sync_all(*, prune: bool = True) -> dict[str, Any]:
    """DATA MART 를 데이터셋에 반영한다. 기동 때와 마트 지정 뒤에 부른다.

    **마트만 내보낸다.** 예전에는 카탈로그 전체를 데이터셋으로 만들었는데,
    그러면 분석에서 원천과 중간 모델까지 고를 수 있어 «무엇을 분석에 쓸 것인가»
    라는 결정이 사라진다. 지금은 그 결정이 마트 지정 하나다.

    prune — 마트가 아니게 됐거나 manifest 에서 사라진 모델의 매핑을 정리한다.
    Superset 데이터셋 자체는 지우지 않는다. 차트가 붙어 있으면 화면이 깨지고,
    되돌릴 방법이 없기 때문이다. 대신 state=orphan 으로 표시해 화면이 드러낼 수
    있게 둔다. (마트 해제는 분석이 하나도 없을 때만 되므로, orphan 이 된 데이터셋을
    쓰는 차트는 원칙적으로 없다.)
    """
    entries = manifest.all_entries()
    marts = store.marts()
    db_id = _database_id()

    results, errors = [], []
    for mid, e in entries.items():
        if not (e.get("phys") or "") or mid not in marts:
            continue
        try:
            results.append(sync_one(mid, e, db_id))
        except ApiError as ex:
            errors.append({"modelId": mid, "error": ex.message,
                           "details": getattr(ex, "details", None)})
        except Exception as ex:      # noqa: BLE001
            logger.exception("데이터셋 동기화 실패: %s", mid)
            errors.append({"modelId": mid, "error": str(ex)[:200]})

    orphans = []
    if prune:
        for mid, row in store.ds_all().items():
            if mid not in entries or mid not in marts:
                store.ds_set(mid, row["datasetId"], row["phys"], state="orphan")
                orphans.append({"modelId": mid, "datasetId": row["datasetId"]})

    by_action: dict[str, int] = {}
    for r in results:
        by_action[r["action"]] = by_action.get(r["action"], 0) + 1
    return {"databaseId": db_id, "synced": len(results), "byAction": by_action,
            "orphans": orphans, "errors": errors, "items": results}
