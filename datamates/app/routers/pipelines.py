"""데이터 파이프라인 — 정의 · 실행 그래프 · 실행.

실행 순서는 API 가 정하지 않는다. 모델의 ref() 관계에서 계산해(graph.build)
Airflow 태스크 의존성으로 옮길 뿐이다. 화면에도 읽기 전용으로 보여준다.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import airflow_client as af
from .. import daggen, graph, manifest, state, store

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/pipelines", tags=["pipelines"])

class PipelineIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = ""
    env: str = "local"
    freq: str = "수동 실행"
    retry: int = Field(1, ge=0, le=5)
    on_fail: Literal["stop", "go"] = "stop"
    notify: bool = True
    targets: list[str] = []
    task_mode: Literal["per_model", "single"] = "per_model"
    # 원천 CSV(seed)를 매 실행마다 다시 적재할지. 기본은 끔 — 아래 graph.build 주석 참고.
    include_seeds: bool = False
    # 실행 트리거 — schedule(예약) / manual / upstream(선행 파이프라인 성공 후)
    # / data_event(조회 전용 입력 모델이 갱신되면)
    trigger_type: Literal["schedule", "manual", "upstream", "data_event"] = "schedule"
    upstream_pipeline_id: str | None = None


class RunIn(BaseModel):
    from_node: str | None = Field(
        None, description="이 모델부터 다시 실행. 비우면 처음부터.")


def _pipeline_or_404(pid: str) -> dict[str, Any]:
    p = store.pipeline_get(pid)
    if not p:
        raise HTTPException(404, f"파이프라인 {pid} 을(를) 찾을 수 없습니다.")
    return p


def _flow(p: dict[str, Any]) -> dict[str, Any]:
    """소유권을 반영한 실행 그래프 — 남의 모델은 조회 전용 입력으로 멈춘다."""
    return graph.flow_for(p, store.pipelines())


def _validate(body: PipelineIn, pid: str | None) -> None:
    """모델 적재 원칙과 트리거를 저장 전에 검사한다.

    · 실행 대상이 이미 다른 파이프라인의 소유면 거부 — 한 모델의 적재
      책임은 파이프라인 하나만 가진다. 그 모델을 쓰려면 대상이 아니라
      입력(조회 전용)으로 두면 된다.
    · 선행 트리거는 실재하는 파이프라인이어야 하고, 자기 자신·순환 금지.
    """
    unknown = [t for t in body.targets if not manifest.get(t)]
    if unknown:
        raise HTTPException(400, f"없는 모델입니다: {', '.join(unknown)}")

    others = [x for x in store.pipelines() if x["id"] != pid]
    owner = graph.ownership(others)

    if body.trigger_type == "data_event":
        pre = graph.build(body.targets, body.include_seeds,
                          stop_at={m for m in owner})
        if not daggen.data_event_watch(pre):
            raise HTTPException(400, (
                "데이터 이벤트로 실행하려면 갱신을 감시할 입력이 있어야 합니다 — "
                "다른 파이프라인이 적재하는 조회 전용 입력 모델, 원천 CSV(seed), "
                "또는 데이터 수집이 적재하는 원천 테이블."))

    clash = [(t, owner[t]) for t in body.targets if t in owner]
    if clash:
        t, o = clash[0]
        oname = (store.pipeline_get(o) or {}).get("name", o)
        raise HTTPException(409, (
            f"{t} 모델은 이미 {oname} 파이프라인이 적재하고 있습니다. "
            f"한 모델의 적재는 파이프라인 하나만 맡습니다 — 이 파이프라인에서는 "
            f"조회 전용 입력으로 사용됩니다. 하류 모델을 대상으로 지정하세요."))

    if body.trigger_type == "upstream":
        up = body.upstream_pipeline_id
        if not up:
            raise HTTPException(400, "선행 파이프라인을 선택해 주세요.")
        if up == pid:
            raise HTTPException(400, "자기 자신을 선행으로 지정할 수 없습니다.")
        if not store.pipeline_get(up):
            raise HTTPException(404, f"선행 파이프라인 {up} 을(를) 찾을 수 없습니다.")
        # 순환 — up 의 선행 사슬을 따라가다 자신을 만나면 안 된다.
        # 비교는 사슬의 «노드»에 대해서만 한다. 사슬 끝(None)과 비교하면
        # 생성 시(pid=None) None==None 으로 항상 거짓 순환이 된다 — 실제로 밟았다.
        seen, cur = set(), up
        while cur and cur not in seen:
            if cur == pid:
                raise HTTPException(400, "순환 의존입니다 — 선행 사슬이 이 파이프라인으로 돌아옵니다.")
            seen.add(cur)
            x = store.pipeline_get(cur)
            cur = x.get("upstream_pipeline_id") if x and x.get("trigger_type") == "upstream" else None


def _suggestion(p: dict[str, Any], flow: dict[str, Any]) -> dict[str, Any] | None:
    """자동 연결 제안 — 시작의 조회 전용 모델을 다른 파이프라인이 적재하면,
    그 파이프라인 완료를 트리거로 연결하라고 제안한다. 저장은 사용자의 확인 후."""
    owner = graph.ownership(store.pipelines())
    ups: dict[str, list[str]] = {}
    for key in flow.get("inputs") or []:
        o = owner.get(key)
        if o and o != p["id"] and o != p.get("upstream_pipeline_id"):
            ups.setdefault(o, []).append(key)
    if not ups or p.get("trigger_type") == "upstream":
        return None
    uid, models = next(iter(sorted(ups.items())))
    up = store.pipeline_get(uid) or {}
    return {
        "upstreamId": uid, "upstreamName": up.get("name", uid), "models": models,
        "message": (f"{models[0]} 모델은 {up.get('name', uid)} 파이프라인이 적재하고 "
                    f"있습니다. {up.get('name', uid)} 이(가) 성공하면 이 파이프라인이 "
                    f"이어서 실행되도록 연결할까요?"),
    }


def _sync_dag(p: dict[str, Any]) -> dict[str, Any]:
    """DAG 파일을 다시 쓴다. 파이프라인 정의가 바뀔 때마다 호출한다."""
    flow = _flow(p)
    path = daggen.write(p, flow)
    return {"flow": flow, "dag_path": str(path), "dag_id": daggen.dag_id_of(p["id"]),
            "cron": daggen.FREQ_CRON.get(p["freq"]), "model_count": len(flow["order"])}


@router.get("")
def list_pipelines() -> list[dict[str, Any]]:
    """목록 — **실행 상태를 함께 내려보낸다.**

    예전에는 snapshot 에서 paused 만 꺼내 쓰고 status·latestRun 을 버렸다. 화면은
    그 둘을 읽게 돼 있어서(toPipe) 목록만으로는 언제나 «대기» 였고, 실제 상태는
    사용자가 연 파이프라인 하나만 폴링으로 따라잡았다. 그래서 파이프라인 흐름
    화면이 실패한 실행을 계속 붙들고 있었다 — 그 사이 성공했는데도.

    비용은 없다. snapshot 이 이미 계산해 캐시해 둔 값을 그대로 옮기는 것뿐이다.
    """
    snap = {x["id"]: x for x in state.snapshot()["pipelines"]}
    out = []
    for p in store.pipelines():
        flow = _flow(p)
        s = snap.get(p["id"]) or {}
        out.append({**p, "dag_id": daggen.dag_id_of(p["id"]),
                    "model_count": len(flow["order"]),
                    "paused": s.get("paused"),
                    "status": s.get("status", "wait"),
                    "latestRun": s.get("latestRun"),
                    "nextRun": s.get("nextRun"),
                    "cron": daggen.FREQ_CRON.get(p["freq"])})
    return out


@router.post("", status_code=201)
def create_pipeline(body: PipelineIn) -> dict[str, Any]:
    _validate(body, None)
    pid = f"pl{int(time.time() * 1000)}"
    p = store.pipeline_upsert(pid, body.model_dump())
    state.invalidate()
    out = {**p, **_sync_dag(p)}
    out["autoStart"] = _autostart(p, out["dag_id"])
    out["suggestion"] = _suggestion(p, out["flow"])
    return out


def _autostart(p: dict[str, Any], dag_id: str) -> bool:
    """스스로 도는 파이프라인이면 만들자마자 깨운다. 켤 예정이면 True.

    Airflow 는 새 DAG 을 **정지 상태로 만든다**(dags_are_paused_at_creation=True).
    그래서 예약이나 데이터 이벤트로 만들어 두면 시각이 와도, 원천이 갱신돼도
    아무 일이 일어나지 않는다. 화면에는 「데이터 이벤트」라고 적혀 있는데 실제로는
    멈춰 있는 것이라, 사용자가 알아챌 방법이 없다 — 실제로 이 프로젝트에서
    수집이 Asset 을 발행했는데 구독 파이프라인이 정지 상태라 그냥 지나갔다.

    수동 실행은 깨우지 않는다. 그건 사람이 누를 때 실행 경로가 알아서 깨운다.
    수정할 때도 깨우지 않는다 — 사용자가 일부러 멈춰 둔 것을 되돌리면 안 된다.

    **응답을 붙잡지 않는다.** DAG 프로세서가 파일을 읽는 데 15초쯤 걸리는데
    그동안 저장 버튼이 멈춰 있으면 안 된다. 뒤에서 기다렸다 켜고, 실패하면
    로그만 남긴다 — 화면의 일시정지 토글로 언제든 켤 수 있다.
    """
    if (p.get("trigger_type") or "schedule") == "manual":
        return False

    def run() -> None:
        try:
            _wait_for_dag(dag_id)
            af.dag_unpause(dag_id)
        except Exception:      # noqa: BLE001
            logger.warning("파이프라인 DAG 을 깨우지 못했습니다: %s", dag_id)

    threading.Thread(target=run, daemon=True).start()
    return True


@router.get("/{pid}")
def get_pipeline(pid: str) -> dict[str, Any]:
    p = _pipeline_or_404(pid)
    flow = _flow(p)
    return {**p, "dag_id": daggen.dag_id_of(pid), "flow": flow,
            "cron": daggen.FREQ_CRON.get(p["freq"])}


@router.put("/{pid}")
def update_pipeline(pid: str, body: PipelineIn) -> dict[str, Any]:
    _pipeline_or_404(pid)
    _validate(body, pid)
    p = store.pipeline_upsert(pid, body.model_dump())
    state.invalidate()
    out = {**p, **_sync_dag(p)}
    out["suggestion"] = _suggestion(p, out["flow"])
    return out


@router.delete("/{pid}")
def delete_pipeline(pid: str) -> dict[str, Any]:
    _pipeline_or_404(pid)

    # 이 파이프라인을 선행으로 쓰는 후행들 — 선행이 사라지면 Asset 이벤트가
    # 영원히 오지 않아 조용히 멈춘 파이프라인이 된다. 독립 실행으로 되돌린다.
    detached: list[str] = []
    for dep in store.pipelines():
        if dep["id"] != pid and dep.get("upstream_pipeline_id") == pid:
            nxt = "schedule" if (dep.get("freq") and dep["freq"] != "수동 실행") else "manual"
            store.pipeline_upsert(dep["id"], {**dep, "trigger_type": nxt,
                                              "upstream_pipeline_id": None})
            detached.append(dep["name"])

    removed = daggen.remove(pid)
    store.pipeline_delete(pid)
    # 캐시를 안 비우면 모델 삭제 가드가 «지워진 파이프라인이 사용 중» 이라며
    # 3초(TTL) 동안 409 를 낸다 — 실제로 겪은 순서다: 파이프라인 삭제 직후 모델 삭제.
    state.invalidate()

    # 남은 파이프라인의 DAG 을 전부 다시 쓴다 — 소유권이 바뀌기 때문이다.
    # (지워진 파이프라인이 맡던 모델은 생성순으로 다음 파이프라인이 승계한다)
    remaining = store.pipelines()
    owner = graph.ownership(remaining)
    for p2 in remaining:
        daggen.write(p2, graph.flow_for(p2, remaining, owner))

    # DAG 파일을 지워도 Airflow 메타DB 에는 한동안 남는다. 같이 정리한다.
    try:
        af.dag_delete(daggen.dag_id_of(pid))
    except af.AirflowError:
        pass
    return {"deleted": pid, "dag_removed": removed, "detached": detached}


@router.get("/{pid}/graph")
def pipeline_graph(pid: str) -> dict[str, Any]:
    return _flow(_pipeline_or_404(pid))


# ---------------------------------------------------------------- 실행

def _wait_for_dag(dag_id: str, timeout: float = 90.0) -> dict[str, Any]:
    """Airflow 가 새 DAG 파일을 읽어들일 때까지 기다린다.

    DAG 프로세서는 주기적으로 폴더를 훑기 때문에 저장 직후에는 아직 없다.
    주기는 AIRFLOW__DAG_PROCESSOR__REFRESH_INTERVAL 이고 docker-compose 에서
    15초로 낮춰 두었다(Airflow 3 기본값은 300초라 그대로 두면 5분을 기다린다).
    첫 실행에서만 걸리는 지연이라 여기서 흡수하고, 넘기면 원인을 그대로 알린다.
    """
    deadline = time.time() + timeout
    while True:
        d = af.dag_get(dag_id)
        if d:
            return d
        if time.time() > deadline:
            raise HTTPException(
                504, f"Airflow 가 {dag_id} 을(를) {timeout:.0f}초 안에 읽지 못했습니다. "
                     "DAG 프로세서 주기(AIRFLOW__DAG_PROCESSOR__REFRESH_INTERVAL)를 "
                     "확인하거나, DAG 파일에 문법 오류가 없는지 보세요.")
        time.sleep(2)


@router.post("/{pid}/runs", status_code=202)
def run_pipeline(pid: str, body: RunIn) -> dict[str, Any]:
    p = _pipeline_or_404(pid)
    flow = _flow(p)
    if not flow["order"]:
        raise HTTPException(400, "실행할 모델이 없습니다. 실행 대상을 먼저 지정해 주세요.")

    if body.from_node and body.from_node not in flow["order"]:
        raise HTTPException(400, f"{body.from_node} 은(는) 이 파이프라인의 실행 대상이 아닙니다.")

    dag_id = daggen.dag_id_of(pid)
    _sync_dag(p)                    # 저장 이후 모델이 바뀌었을 수 있으니 항상 최신화
    _wait_for_dag(dag_id)
    af.dag_unpause(dag_id)

    run = af.trigger(dag_id, conf={"pipeline_id": pid, "from_node": body.from_node},
                     note=None)
    run_id = run["dag_run_id"]
    store.run_log_add(run_id, pid, body.from_node)

    # 부분 재실행은 Airflow 의 clear 로 처리한다. 새 run 을 만든 뒤 필요 없는
    # 앞 단계를 성공으로 두고 대상만 다시 돌리는 방식은 상태가 꼬인다.
    rerun_from = None
    if body.from_node and p["task_mode"] == "per_model":
        rerun_from = graph.downstream_of(flow["order"], body.from_node, flow["edges"])

    return {"dag_id": dag_id, "run_id": run_id, "state": run.get("state"),
            "from_node": body.from_node, "will_run": rerun_from or flow["order"]}


@router.post("/{pid}/runs/{run_id}/rerun", status_code=202)
def rerun_from(pid: str, run_id: str, body: RunIn) -> dict[str, Any]:
    """이미 끝난 실행에서 특정 모델부터 다시 돌린다 — Airflow 의 clear 를 쓴다."""
    p = _pipeline_or_404(pid)
    flow = _flow(p)
    if p["task_mode"] != "per_model":
        raise HTTPException(
            400, "task_mode 가 single 인 파이프라인은 모델 단위 재실행을 할 수 없습니다. "
                 "전체를 다시 실행하거나 per_model 로 바꿔 주세요.")
    if not body.from_node or body.from_node not in flow["order"]:
        raise HTTPException(400, "다시 실행할 모델을 지정해 주세요.")

    targets = graph.downstream_of(flow["order"], body.from_node, flow["edges"])
    af.clear_tasks(daggen.dag_id_of(pid), run_id, [daggen.task_id_of(m) for m in targets])
    return {"run_id": run_id, "cleared": targets}


@router.get("/{pid}/runs")
def list_runs(pid: str, limit: int = 20) -> list[dict[str, Any]]:
    _pipeline_or_404(pid)
    runs = af.dag_runs(daggen.dag_id_of(pid), limit=limit)
    return [{"run_id": r["dag_run_id"], "state": r.get("state"),
             "start": r.get("start_date"), "end": r.get("end_date"),
             "from_node": (store.run_log_get(r["dag_run_id"]) or {}).get("from_node")}
            for r in runs]


@router.get("/{pid}/runs/latest")
def latest_run(pid: str) -> dict[str, Any]:
    p = _pipeline_or_404(pid)
    runs = af.dag_runs(daggen.dag_id_of(pid), limit=1)
    if not runs:
        return {"run_id": None, "state": None, "nodes": {},
                "flow": _flow(p), "message": "아직 실행한 적이 없습니다."}
    return run_detail(pid, runs[0]["dag_run_id"])


@router.get("/{pid}/runs/{run_id}")
def run_detail(pid: str, run_id: str) -> dict[str, Any]:
    """모델별 상태를 조립한다.

    Airflow 태스크 상태 = 돌았는가 / 실패했는가.
    dbt run_results.json = 몇 건을 처리했는가 / 얼마나 걸렸는가 / 테스트는 어땠는가.
    화면은 둘 다 필요해서 여기서 합친다.
    """
    p = _pipeline_or_404(pid)
    flow = _flow(p)
    dag_id = daggen.dag_id_of(pid)

    run = af.dag_run(dag_id, run_id)
    tis = {t["task_id"]: t for t in af.task_instances(dag_id, run_id)}
    results = daggen.read_run_results(pid, run_id)

    # 테스트 결과는 모델과 별도 노드다. 모델별로 먼저 묶는다 — 아래 노드 상태
    # 판정이 이걸 본다(모델 생성은 성공했는데 테스트가 깨진 경우의 err 승격).
    #
    # 이름으로 맞추면 안 된다 — 제네릭 테스트의 unique_id 는
    # test.analytics.not_null_stg_events_user_id.<해시> 라서 마지막 조각이 해시다.
    # (싱귤러 테스트는 해시가 없어서 이름으로도 맞아 버려, 그 둘만 잡히는 걸 못 알아채기 쉽다)
    entries = manifest.all_entries()
    by_uid: dict[str, list[tuple[str, dict[str, Any]]]] = {}
    for mid in flow["order"]:
        for t in entries.get(mid, {}).get("tests", []):
            by_uid.setdefault(t["unique_id"], []).append((mid, t))

    tests_by_model: dict[str, list[dict[str, Any]]] = {m: [] for m in flow["order"]}
    for rr in results.values():
        if rr.get("resource_type") != "test":
            continue
        for mid, t in by_uid.get(rr["unique_id"], []):
            tests_by_model[mid].append({
                "name": t["name"], "type": t["type"], "col": t["col"],
                "severity": t["severity"], "status": rr.get("status"),
                "failures": rr.get("failures"), "message": rr.get("message"),
            })

    nodes: dict[str, Any] = {}
    for mid in flow["order"]:
        task_id = "build__all" if p["task_mode"] == "single" else daggen.task_id_of(mid)
        ti = tis.get(task_id, {})
        rr = results.get(mid, {})
        failed = sum(1 for t in tests_by_model.get(mid, [])
                     if t["status"] in ("fail", "error"))
        st = state.node_state(rr.get("status"), ti.get("state"), failed > 0)
        msg = rr.get("message")
        if failed and st == "err" and rr.get("status") in ("success", "pass"):
            msg = f"모델은 만들어졌지만 테스트 {failed}건이 실패했습니다."
        nodes[mid] = {
            "state": st,
            "task_id": task_id,
            "airflow_state": ti.get("state"),
            "dbt_status": rr.get("status"),
            "duration": rr.get("execution_time") or ti.get("duration"),
            "rows": rr.get("rows_affected"),
            "message": msg,
            "try_number": ti.get("try_number", 1),
            "start": ti.get("start_date"), "end": ti.get("end_date"),
        }

    return {
        "run_id": run_id, "state": run.get("state"),
        "start": run.get("start_date"), "end": run.get("end_date"),
        "from_node": (store.run_log_get(run_id) or {}).get("from_node"),
        "nodes": nodes, "tests": tests_by_model, "flow": flow,
    }


@router.get("/{pid}/runs/{run_id}/nodes/{model_id}/log")
def node_log(pid: str, run_id: str, model_id: str, try_number: int = 1) -> dict[str, Any]:
    p = _pipeline_or_404(pid)
    task_id = "build__all" if p["task_mode"] == "single" else daggen.task_id_of(model_id)
    try:
        text = af.task_log(daggen.dag_id_of(pid), run_id, task_id, try_number)
    except af.AirflowError as e:
        raise HTTPException(e.status or 500, f"로그를 가져오지 못했습니다: {e}") from e
    return {"model_id": model_id, "task_id": task_id, "try_number": try_number, "log": text}
