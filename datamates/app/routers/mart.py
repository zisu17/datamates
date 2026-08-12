"""DATA MART — 데이터 모델에 부여하는 역할.

마트를 별도의 객체로 두지 않는다. 같은 모델 하나가 «일반 DATA MODEL» 이거나
«DATA MART» 이고, 그 차이는 상태 하나다. 새 테이블도, 새 SQL 도 만들지 않는다.

    SOURCE → model_a → model_b → model_c
                                    └ DATA MART 지정 → 데이터 분석에서 사용 가능

지정과 해제에 규칙이 붙는 이유는 둘 다 다른 화면의 전제를 바꾸기 때문이다.

  · 지정 — 마트는 항상 «최종 모델» 이다. 다른 모델이 입력으로 쓰는 모델을
    마트로 만들면 「분석에서 쓰는 데이터」와 「중간 가공 데이터」가 같은 것이
    되어 카탈로그의 구분이 무너진다. 그래서 하류 모델이 있으면 거절한다.
    반대 방향(마트를 ref() 로 부르는 SQL)은 models.py 가 막는다.

  · 해제 — 분석이 그 마트를 보고 있으면 해제가 곧 분석을 깨뜨린다. 조용히
    깨뜨리는 대신 무엇이 쓰고 있는지 세어 돌려주고 막는다.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from .. import manifest, state, store
from ..errors import ApiError, not_found
from . import analytics as ana

router = APIRouter(tags=["models"])


def _entry(model_id: str) -> dict[str, Any]:
    e = manifest.get(model_id)
    if not e:
        raise not_found(model_id)
    return e


def _downstream_models(e: dict[str, Any]) -> list[str]:
    """이 모델을 입력으로 쓰는 모델들. 마트 지정의 유일한 차단 사유다."""
    entries = manifest.all_entries()
    return [d for d in e["downstream"] if d in entries]


def mart_status(model_id: str, *, with_usage: bool = True) -> dict[str, Any]:
    """화면이 모델 상세에서 그대로 그리는 것.

    usage 는 분석 엔진 조회라 비용이 있다. 목록 화면처럼 여러 모델을 한 번에
    볼 때는 with_usage=False 로 부른다.
    """
    e = _entry(model_id)
    is_mart = model_id in store.marts()
    downstream = _downstream_models(e)

    out: dict[str, Any] = {
        "modelId": model_id,
        "name": e["name"],
        "group": "DATA MART" if is_mart else e["group"],
        "isMart": is_mart,
        "markedAt": store.mart_marked_at(model_id),
        "downstreamModels": downstream,
        # 마트로 지정할 수 있는가 — 화면이 버튼을 흐리게 두고 이유를 붙인다.
        "canMark": bool(e["kind"] == "model" and not downstream and not is_mart),
        "markBlockedReason": _mark_blocked(e, downstream, is_mart),
    }
    if with_usage:
        out.update(mart_usage(model_id, is_mart))
    return out


def _mark_blocked(e: dict[str, Any], downstream: list[str], is_mart: bool) -> str:
    if is_mart:
        return ""
    if e["kind"] != "model":
        return "SOURCE 는 DATA MART 로 지정할 수 없습니다. 데이터 모델을 거쳐야 합니다."
    if downstream:
        names = ", ".join(downstream)
        return (f"{e['name']} 은(는) {names} 의 입력으로 쓰이고 있어 최종 모델이 아닙니다. "
                "DATA MART 는 항상 최종 모델이어야 합니다.")
    return ""


def mart_usage(model_id: str, is_mart: bool | None = None) -> dict[str, Any]:
    """이 모델을 쓰는 분석 — 해제 가능 여부의 근거.

    데이터셋 매핑이 없으면 분석이 붙었을 수 없으므로 엔진을 부르지 않는다.
    엔진이 응답하지 않으면 «모른다» 를 그대로 돌려준다. 사용 중이 아닌 것으로
    단정하고 해제해 버리면 남의 대시보드가 조용히 깨진다.
    """
    if is_mart is None:
        is_mart = model_id in store.marts()
    ds = store.ds_all().get(model_id)
    if not ds:
        return {"analyses": [], "analysisCount": 0, "dashboards": [],
                "usageKnown": True, "canUnmark": is_mart, "unmarkBlockedReason": ""}

    try:
        used = ana.model_analyses(model_id)
    except Exception as exc:      # noqa: BLE001 — 엔진 장애가 카탈로그를 막지 않는다
        return {"analyses": [], "analysisCount": 0, "dashboards": [],
                "usageKnown": False, "canUnmark": False,
                "unmarkBlockedReason":
                    "분석 엔진에 연결할 수 없어 사용 중인 분석을 확인하지 못했습니다. "
                    f"확인 후 다시 시도해 주세요. ({str(exc)[:80]})"}

    n = len(used["analyses"])
    reason = ""
    if n:
        reason = (f"이 데이터 마트는 현재 {n}개의 분석에서 사용 중이므로 "
                  "DATA MART 지정을 해제할 수 없습니다. "
                  "먼저 해당 분석과의 연결을 제거해 주세요.")
    return {**used, "analysisCount": n, "usageKnown": True,
            "canUnmark": bool(is_mart and not n), "unmarkBlockedReason": reason}


@router.get("/models/{model_id}/mart")
def get_mart(model_id: str) -> dict[str, Any]:
    return mart_status(model_id)


@router.post("/models/{model_id}/mart")
def mark_mart(model_id: str) -> dict[str, Any]:
    e = _entry(model_id)
    if model_id in store.marts():
        return mart_status(model_id)

    downstream = _downstream_models(e)
    reason = _mark_blocked(e, downstream, False)
    if reason:
        raise ApiError("MART_NOT_FINAL", reason,
                       {"modelId": model_id, "downstreamModels": downstream},
                       status=409)

    store.mart_set(model_id, True)
    # 마트가 되어야 분석에서 고를 수 있다 — 데이터셋을 지금 만들어 둔다.
    synced, sync_error = _sync_one(model_id, e)
    return {**mart_status(model_id), "synced": synced, "syncError": sync_error,
            "message": f"{e['name']} 을(를) DATA MART 로 지정했습니다. "
                       "데이터 분석에서 선택할 수 있습니다."}


@router.delete("/models/{model_id}/mart")
def unmark_mart(model_id: str) -> dict[str, Any]:
    e = _entry(model_id)
    if model_id not in store.marts():
        return mart_status(model_id)

    usage = mart_usage(model_id, True)
    if not usage["canUnmark"]:
        raise ApiError(
            "MART_IN_USE", usage["unmarkBlockedReason"],
            {"modelId": model_id, "analysisCount": usage["analysisCount"],
             "analyses": usage["analyses"], "dashboards": usage["dashboards"],
             "usageKnown": usage["usageKnown"]},
            status=409)

    store.mart_set(model_id, False)
    return {**mart_status(model_id),
            "message": f"{e['name']} 의 DATA MART 지정을 해제했습니다. "
                       "일반 데이터 모델로 돌아갑니다."}


def _sync_one(model_id: str, entry: dict[str, Any]) -> tuple[bool, str]:
    from ..analytics import sync as ds_sync
    try:
        ds_sync.sync_one(model_id, entry, ds_sync._database_id())
        return True, ""
    except Exception as exc:      # noqa: BLE001 — 지정 자체는 이미 유효하다
        return False, str(exc)[:200]


@router.get("/marts")
def list_marts() -> dict[str, Any]:
    """DATA MART 목록 — 카탈로그의 DATA MART 영역과 분석의 데이터 선택이 쓴다."""
    entries = manifest.all_entries()
    ids = store.marts()
    snap = state.snapshot()
    items = []
    for mid in sorted(ids):
        e = entries.get(mid)
        if not e:
            continue          # 모델이 지워졌다 — 고아 행은 보여주지 않는다
        pipes = [{"id": p["id"], "name": p["name"], "status": p["status"]}
                 for p in snap["pipelines"] if mid in p["flow"]["order"]]
        items.append({"id": mid, "name": e["name"], "phys": e["phys"],
                      "desc": e["desc"], "upstream": e["upstream"],
                      "pipelines": pipes,
                      "markedAt": store.mart_marked_at(mid)})
    return {"items": items, "total": len(items)}
