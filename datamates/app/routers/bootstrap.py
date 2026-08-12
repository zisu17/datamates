"""화면 부팅용 통합 조회.

UI 는 렌더가 동기라 다 있는 상태에서 시작해야 한다. 화면마다 따로 부르면
모델 수만큼 요청이 나가고(N+1) 첫 화면이 늦다. 여기서 한 번에 모아 준다.

계산은 하지 않는다 — state 모듈이 만든 것을 화면 모양으로 옮길 뿐이다.
여기서 따로 계산하면 홈과 품질 화면의 숫자가 갈린다.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from .. import daggen, dbtproj, manifest, state, store

# 실행 환경 = dbt 타깃. profiles.yml 의 outputs 와 이름이 일치해야 한다.
# (identity 기능을 걷어낼 때 session 라우터에서 옮겨왔다 — 소비처가 여기뿐이다)
ENVS = [
    {"env": "local", "label": "개발", "schema": "analytics", "approvalPolicy": "자유 실행"},
    {"env": "local_heavy", "label": "검증", "schema": "analytics", "approvalPolicy": "승인 후 실행"},
    {"env": "remote", "label": "운영", "schema": "analytics", "approvalPolicy": "배포 승인 필요"},
]

router = APIRouter(tags=["bootstrap"])

# 카탈로그 정렬 = 데이터가 흐르는 순서다. 수집이 만든 SOURCE 가 먼저 오고,
# 그것으로 만든 DATA MODEL, 그중 분석에 내보내는 DATA MART 가 마지막이다.
GROUP_ORDER = {"SOURCE": 0, "DATA MODEL": 1, "DATA MART": 2}


def _layer(entry: dict[str, Any], is_mart: bool) -> str:
    """가공 단계 — 화면의 색과 구분 라벨이 쓴다.

    원천 · 정제 · 분석용까지는 dbt 디렉터리에서 나오는 표시용 분류다.
    마트만 다르다 — 사용자가 명시적으로 지정한 상태이고, «분석에서 쓸 수 있는
    데이터» 라는 뜻이 붙는다.
    """
    if entry["kind"] == "source":
        return "원천"
    if is_mart:
        return "마트"
    return "정제" if "/staging/" in (entry.get("path") or "") else "분석용"


@router.get("/bootstrap")
def bootstrap() -> dict[str, Any]:
    entries = manifest.all_entries()
    placed = store.model_folders()
    marts = store.marts()
    snap = state.snapshot()
    rs = state.rules()

    items = []
    for e in entries.values():
        run = snap["nodeRuns"].get(e["id"])
        is_mart = e["id"] in marts
        items.append({
            "id": e["id"], "name": e["name"], "phys": e["phys"],
            # group 은 화면의 카탈로그 구분이다. 마트는 별도 객체가 아니지만
            # 카탈로그에서는 DATA MART 영역에 놓인다 — 상태가 곧 위치다.
            "group": "DATA MART" if is_mart else e["group"],
            "baseGroup": e["group"], "isMart": is_mart,
            "kind": e["kind"], "dbtType": e["dbt_type"],
            "layer": _layer(e, is_mart), "desc": e["desc"], "mat": e["mat"],
            "tags": e["tags"], "path": e["path"], "folderId": placed.get(e["id"]),
            "cols": e["cols"], "colDesc": e["col_desc"],
            "upstream": e["upstream"], "downstream": e["downstream"],
            "quality": state.quality_of(e["id"], rs),
            "sql": dbtproj.read_sql(e["id"]) if e["kind"] == "model" else None,
            "run": run,
        })
    items.sort(key=lambda x: (GROUP_ORDER.get(x["group"], 9), x["name"]))

    pipes = [{
        "id": p["id"], "name": p["name"], "description": p["description"],
        "env": p["env"], "freq": p["freq"], "retry": p["retry"],
        "onFail": p["on_fail"], "notify": p["notify"], "taskMode": p["task_mode"],
        "includeSeeds": p["include_seeds"],
        "targets": p["targets"], "dagId": p["dagId"], "cron": p["cron"],
        "flow": p["flow"], "latestRun": p["latestRun"], "status": p["status"],
        "paused": p["paused"], "nextRun": p.get("nextRun"),
        "modelCount": p["modelCount"],
        "triggerType": p.get("trigger_type") or "schedule",
        "upstreamPipelineId": p.get("upstream_pipeline_id"),
    } for p in snap["pipelines"]]

    return {
        "meta": manifest.meta(),
        "items": items,
        "pipelines": pipes,
        "folders": store.folders(),
        "rules": rs,
        "scheduleOptions": list(daggen.FREQ_CRON),
        # 실행 환경은 dbt 타깃(local / local_heavy / remote)이다.
        # 화면이 자체 목록(dev/stg/prod)을 들고 있으면 서버가 준 env 를 못 찾아
        # 실행 정보 패널이 통째로 깨진다 — 목록을 서버에서 내려준다.
        "envs": ENVS,
        "defaultEnv": store.pref_get("defaultEnv", "local"),
        "airflowOk": snap["airflowOk"],
    }
