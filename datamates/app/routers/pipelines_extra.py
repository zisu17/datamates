"""파이프라인 부가 인터페이스 — 설계서 7.1 잔여 · 7.2 · 8.3.

실행 순서는 서버가 계산한다(설계서 7장). 화면에는 순서 편집 UI 가 없고
위상 정렬 결과를 표시만 하므로, 클라이언트 계산으로 남기면 화면의 번호와
실제 실행 순서가 어긋난다.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, Literal

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .. import airflow_client as af
from .. import daggen, dbtproj, graph, ingest, ingestdag, manifest, state, store
from ..errors import ApiError, not_found

router = APIRouter(tags=["pipelines"])

GROUPS_KEY = "pipeline.groups"


class GroupIn(BaseModel):
    name: str
    pipelineIds: list[str] = []


class ConfigIn(BaseModel):
    freq: str | None = None
    env: str | None = None
    retry: int | None = None
    onFail: Literal["stop", "go"] | None = None
    notify: bool | None = None
    includeSeeds: bool | None = None
    trigger_type: Literal["schedule", "manual", "upstream", "data_event"] | None = None
    upstream_pipeline_id: str | None = None
    # None=바꾸지 않음 과 «해제»를 구분하기 위한 명시 플래그
    clear_upstream: bool = False


class GraphIn(BaseModel):
    nodes: list[dict[str, Any]]
    edges: list[dict[str, str]] = []


class EdgeCheckIn(BaseModel):
    from_: str | None = None
    to: str | None = None

    model_config = {"populate_by_name": True, "extra": "allow"}


def _pipe(pid: str) -> dict[str, Any]:
    p = store.pipeline_get(pid)
    if not p:
        raise not_found(pid)
    return p


# ---------------------------------------------------------------- 묶음 · 선택지

@router.get("/pipeline-groups")
def groups() -> dict[str, Any]:
    raw = store.pref_get(GROUPS_KEY, "[]")
    try:
        items = json.loads(raw)
    except ValueError:
        items = []
    known = {p["id"] for p in store.pipelines()}
    for g in items:
        g["pipelineIds"] = [x for x in g.get("pipelineIds", []) if x in known]
    return {"items": items, "total": len(items)}


@router.post("/pipeline-groups", status_code=201)
def create_group(body: GroupIn) -> dict[str, Any]:
    import time
    items = groups()["items"]
    g = {"id": f"pg{int(time.time() * 1000)}", "name": body.name,
         "pipelineIds": body.pipelineIds}
    items.append(g)
    store.pref_set(GROUPS_KEY, json.dumps(items, ensure_ascii=False))
    return g


@router.delete("/pipeline-groups/{group_id}")
def delete_group(group_id: str) -> dict[str, Any]:
    items = [g for g in groups()["items"] if g["id"] != group_id]
    store.pref_set(GROUPS_KEY, json.dumps(items, ensure_ascii=False))
    return {"deleted": group_id}


@router.get("/schedule-options")
def schedule_options() -> dict[str, Any]:
    items = [{"value": k, "cron": v, "manual": v is None}
             for k, v in daggen.FREQ_CRON.items()]
    return {"items": items, "total": len(items)}


# ---------------------------------------------------------------- 구성 · 순서

@router.get("/pipelines/{pid}/exec-order")
def exec_order(pid: str) -> dict[str, Any]:
    """계산된 실행 순서 — 읽기 전용 (설계서 7.1).

    SOURCE 는 실행 대상이 아니라 참조 전용이므로 seq 없이 source:true 로 나간다.
    """
    p = _pipe(pid)
    flow = graph.build(p["targets"], p["include_seeds"])
    deps: dict[str, list[str]] = {n["key"]: [] for n in flow["nodes"]}
    for e in flow["edges"]:
        deps[e["to"]].append(e["from"])
    order = [{"key": n["key"], "id": n["id"], "seq": n["seq"],
              "source": not n["executable"], "dependsOn": deps[n["key"]]}
             for n in sorted(flow["nodes"], key=lambda n: (n["seq"] or 0, n["depth"]))]
    return {"order": order, "total": len(order)}


@router.put("/pipelines/{pid}/graph")
def put_graph(pid: str, body: GraphIn) -> dict[str, Any]:
    """구성 저장 — 노드 목록에서 실행 대상을 뽑아 갱신한다.

    연결(edges)은 저장하지 않는다. 모델 사이의 관계는 SQL 의 ref() 가 정하므로,
    화면에서 그은 선을 따로 저장하면 SQL 과 어긋난 두 번째 진실이 생긴다.
    화면이 보내는 좌표만 받아 두고, 순서는 다시 계산해 돌려준다.
    """
    p = _pipe(pid)
    ids = []
    for n in body.nodes:
        mid = n.get("id")
        e = manifest.get(mid or "")
        if e and e["kind"] == "model" and mid not in ids:
            ids.append(mid)
    p = store.pipeline_upsert(pid, {**p, "targets": ids})
    flow = graph.build(ids, p["include_seeds"])
    daggen.write(p, flow)
    state.invalidate()
    return {"nodes": flow["nodes"], "edges": flow["edges"], "order": flow["order"]}


@router.post("/pipelines/{pid}/graph:validate")
def validate_edge(pid: str, body: dict[str, Any]) -> dict[str, Any]:
    """연결 시도 사전 검증 (설계서 7.1).

    화면은 선을 놓기 전에 이걸 물어 이미 연결됨 / 순환 / SOURCE 입력을 구분한다.
    """
    _pipe(pid)                         # 404 검사만 — 파이프라인 자체는 안 쓴다
    src, dst = body.get("from"), body.get("to")
    if not src or not dst:
        raise ApiError("INVALID_ARGUMENT", "from 과 to 를 모두 지정해 주세요.")
    a, b = manifest.get(src), manifest.get(dst)
    if not a or not b:
        raise not_found(src if not a else dst)

    if b["kind"] == "source":
        raise ApiError("GRAPH_SOURCE_INPUT",
                       "SOURCE 는 다른 데이터를 입력으로 받지 않습니다.")
    if src in b["upstream"]:
        raise ApiError("GRAPH_DUPLICATE_EDGE", "이미 연결되어 있습니다.")
    if dst in manifest.lineage(src)["upstream"] or dst == src:
        raise ApiError("GRAPH_CYCLE", "순환 연결은 만들 수 없습니다.")

    return {"valid": True,
            "message": (f"{a['name']} → {b['name']} 연결은 "
                        f"{b['name']} 의 SQL 에 ref('{src}') 를 추가하면 만들어집니다.")}


class PausedIn(BaseModel):
    paused: bool


@router.patch("/pipelines/{pid}/paused")
def set_paused(pid: str, body: PausedIn) -> dict[str, Any]:
    """예약 실행 끄고 켜기.

    상태는 Airflow 가 소유한다(메타스토어에 복사해 두면 Airflow UI 에서 바꾼 것과 어긋난다).
    끈다고 이미 돌고 있는 실행이 멈추지는 않고, 수동 실행도 그대로 된다 —
    멈추는 것은 예약대로 자동으로 도는 것 뿐이다.
    """
    p = _pipe(pid)
    dag_id = daggen.dag_id_of(pid)
    if not af.dag_get(dag_id):
        raise ApiError(
            "UPSTREAM_UNAVAILABLE",
            f"{p['name']} 의 DAG 이 아직 Airflow 에 등록되지 않았습니다. "
            "잠시 뒤 다시 시도해 주세요.", {"dagId": dag_id}, status=503)
    af.dag_set_paused(dag_id, body.paused)
    state.invalidate()
    return {"id": pid, "dagId": dag_id, "paused": body.paused,
            "message": ("예약 실행을 껐습니다. 수동 실행은 그대로 할 수 있습니다."
                        if body.paused else "예약 실행을 켰습니다.")}


def _flow_owned(p: dict[str, Any]) -> dict[str, Any]:
    return graph.flow_for(p, store.pipelines())


@router.get("/pipelines/{pid}/config")
def get_config(pid: str) -> dict[str, Any]:
    p = _pipe(pid)
    up = p.get("upstream_pipeline_id")
    return {"freq": p["freq"], "env": p["env"], "retry": p["retry"],
            "onFail": p["on_fail"], "notify": p["notify"],
            "taskMode": p["task_mode"], "cron": daggen.FREQ_CRON.get(p["freq"]),
            "includeSeeds": p["include_seeds"],
            "triggerType": p.get("trigger_type") or "schedule",
            "upstreamPipelineId": up,
            "upstreamPipelineName": (store.pipeline_get(up) or {}).get("name") if up else None}


@router.put("/pipelines/{pid}/config")
def put_config(pid: str, body: ConfigIn) -> dict[str, Any]:
    p = _pipe(pid)
    fields = {"freq": body.freq, "env": body.env, "retry": body.retry,
              "on_fail": body.onFail, "notify": body.notify,
              "include_seeds": body.includeSeeds,
              "trigger_type": body.trigger_type}
    merged = {**p, **{k: v for k, v in fields.items() if v is not None}}

    if body.upstream_pipeline_id is not None or body.clear_upstream:
        merged["upstream_pipeline_id"] = (None if body.clear_upstream
                                          else body.upstream_pipeline_id)
    # 트리거 검증은 파이프라인 저장과 같은 규칙을 쓴다
    if merged.get("trigger_type") == "upstream":
        up = merged.get("upstream_pipeline_id")
        if not up:
            raise ApiError("INVALID_ARGUMENT", "선행 파이프라인을 선택해 주세요.")
        if up == pid:
            raise ApiError("INVALID_ARGUMENT", "자기 자신을 선행으로 지정할 수 없습니다.")
        if not store.pipeline_get(up):
            raise not_found(up)
        seen, cur = set(), up
        while cur and cur not in seen:
            seen.add(cur)
            x = store.pipeline_get(cur)
            cur = (x.get("upstream_pipeline_id")
                   if x and x.get("trigger_type") == "upstream" else None)
            if cur == pid:
                raise ApiError("INVALID_ARGUMENT",
                               "순환 의존입니다 — 선행 사슬이 이 파이프라인으로 돌아옵니다.")

    # 검증은 저장 «앞»이다 — 뒤에 두면 400 을 돌려주고도 값이 남는다.
    flow = _flow_owned({**p, **merged})
    if merged.get("trigger_type") == "data_event" and not daggen.data_event_watch(flow):
        raise ApiError("INVALID_ARGUMENT",
                       "데이터 이벤트로 실행하려면 갱신을 감시할 입력이 있어야 합니다 — "
                       "다른 파이프라인이 적재하는 조회 전용 입력 모델, 원천 CSV(seed), "
                       "또는 데이터 수집이 적재하는 원천 테이블.")
    p = store.pipeline_upsert(pid, merged)
    daggen.write(p, flow)
    state.invalidate()
    return get_config(pid)


def _ingest_run_state(job: dict[str, Any]) -> dict[str, Any]:
    """수집 작업의 예약·최근 실행 상태.

    걸린 시간 계산은 수집 라우터의 것을 그대로 쓴다. 같은 실행이 목록과
    그래프에서 다르게 보이지 않으려면 재는 자리가 하나여야 한다.
    """
    from .ingest import _run_view

    dag_id = ingestdag.dag_id_of(job["id"])
    paused = None
    next_run = None
    try:
        dag = af.dag_get(dag_id)
        paused, next_run = bool(dag.get("is_paused")), dag.get("next_dagrun_run_after")
    except af.AirflowError:
        pass
    try:
        runs = af.dag_runs(dag_id, limit=1)
    except af.AirflowError:
        runs = []
    last = _run_view(runs[0]) if runs else None
    state_of = {"success": "ok", "failed": "err", "running": "run"}
    return {"paused": paused, "nextRun": next_run, "latestRun": last,
            "status": state_of.get((last or {}).get("state"), "wait")}


@router.get("/pipelines/flow")
def pipelines_flow() -> dict[str, Any]:
    """파이프라인 단위 DAG — 전체 흐름 화면이 그린다.

    모델 간선(데이터 의존성)과는 다른 층이다: 여기 간선은 실행 의존성,
    즉 선행 파이프라인 완료(성공) → 후행 시작이라는 트리거 관계다.
    """
    snap = state.snapshot()
    by_id = {x["id"]: x for x in snap["pipelines"]}
    nodes, edges = [], []
    for p in store.pipelines():
        x = by_id.get(p["id"], {})
        nodes.append({
            "id": p["id"], "name": p["name"], "kind": "pipeline",
            "freq": p["freq"],
            "triggerType": p.get("trigger_type") or "schedule",
            "upstreamPipelineId": p.get("upstream_pipeline_id"),
            "status": x.get("status", "wait"), "paused": x.get("paused"),
            "latestRun": x.get("latestRun"), "nextRun": x.get("nextRun"),
            "modelCount": x.get("modelCount", 0),
            "inputs": (x.get("flow") or {}).get("inputs", []),
        })
        if p.get("trigger_type") == "upstream" and p.get("upstream_pipeline_id"):
            edges.append({"from": p["upstream_pipeline_id"], "to": p["id"],
                          "cond": "success"})

    # 수집 → 가공. 파이프라인이 읽는 원천과, 그 원천에 적재하는 수집 작업을 잇는다.
    # 실제로 둘을 잇는 것은 Asset 이지만(수집 DAG 의 outlets = 파이프라인 DAG 의
    # schedule), 화면에 그리기에는 «누가 이 테이블을 채우는가» 로 보는 편이 곧다.
    for j in store.ingest_jobs():
        nodes.append({
            "id": j["id"], "name": j["name"], "kind": "ingest",
            "freq": j.get("freq") or "수동 실행",
            "triggerType": j.get("trigger_type") or "schedule",
            "target": j["target"], "phys": f"{ingest.RAW_SCHEMA}.{j['target']}",
            **_ingest_run_state(j),
        })

    fills = {j["target"]: j["id"] for j in store.ingest_jobs()}
    for p in store.pipelines():
        flow = (by_id.get(p["id"], {}).get("flow") or {})
        for n in flow.get("nodes") or []:
            src = fills.get(n["id"]) if n.get("dbt_type") == "source" else None
            if src:
                edges.append({"from": src, "to": p["id"], "cond": "asset"})
    return {"nodes": nodes, "edges": edges}


# ---------------------------------------------------------------- 실행 부가

@router.get("/pipelines/{pid}/trend")
def trend(pid: str, days: int = Query(7, ge=1, le=90)) -> dict[str, Any]:
    """최근 N일 실행 추이. 실행이 없는 날은 항목을 만들지 않는다."""
    from collections import defaultdict
    from datetime import datetime

    _pipe(pid)
    per_day: dict[str, dict[str, int]] = defaultdict(lambda: {"ok": 0, "err": 0})
    for r in af.dag_runs(daggen.dag_id_of(pid), limit=days * 6):
        ts = r.get("end_date") or r.get("start_date")
        if not ts:
            continue
        try:
            day = datetime.fromisoformat(ts.replace("Z", "+00:00")).strftime("%m.%d")
        except ValueError:
            continue
        per_day[day]["ok" if r.get("state") == "success" else "err"] += 1
    items = [{"date": d, **v} for d, v in sorted(per_day.items())][-days:]
    return {"items": items, "total": len(items)}


@router.get("/pipelines/{pid}/runs/{run_id}/nodes/{node_key}/sql")
def node_sql(pid: str, run_id: str, node_key: str) -> dict[str, Any]:
    """실행 시점 SQL. dbt 가 컴파일해 둔 것을 그대로 보여준다."""
    _pipe(pid)
    e = manifest.get(node_key)
    if not e:
        raise not_found(node_key)
    if e["kind"] == "source":
        return {"modelId": node_key, "sql": None,
                "message": "SOURCE 는 SQL 없이 그대로 들어옵니다."}
    return {"modelId": node_key,
            "sql": dbtproj.read_sql(node_key),
            "compiled": dbtproj.compiled_sql(node_key)}


@router.get("/pipelines/{pid}/runs/{run_id}/nodes/{node_key}/quality")
def node_quality(pid: str, run_id: str, node_key: str) -> dict[str, Any]:
    _pipe(pid)
    if not manifest.get(node_key):
        raise not_found(node_key)
    items = [{"ruleId": r["id"], "name": r["name"], "cond": r["cond"],
              "cnt": r["cnt"], "status": r["status"], "sev": r["sev"]}
             for r in state.rules() if r["modelId"] == node_key and r["active"]]
    return {"items": items, "total": len(items)}


# ---------------------------------------------------------------- 실시간 (8.3)

@router.get("/pipelines/{pid}/runs/{run_id}/events")
async def run_events(pid: str, run_id: str) -> StreamingResponse:
    """실행 중 노드 상태를 SSE 로 흘려보낸다.

    폴링과 결과는 같지만, 진행 중인 파이프라인이 여러 개일 때 요청 수가
    주기 × 파이프라인 수로 늘지 않는다. 서버가 대신 3초마다 확인한다.
    """
    _pipe(pid)

    async def gen():
        last: dict[str, str] = {}
        for _ in range(400):                     # 최대 20분
            state.invalidate()
            snap = state.snapshot(force=True)
            p = next((x for x in snap["pipelines"] if x["id"] == pid), None)
            if not p:
                break
            for mid in p["flow"]["order"]:
                r = snap["nodeRuns"].get(mid) or {}
                st = r.get("st", "wait")
                if last.get(mid) != st:
                    last[mid] = st
                    payload = {"key": mid, "st": st,
                               "dur": r.get("dur"), "rows": r.get("rows")}
                    yield f"event: node\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"
            if p["status"] in ("ok", "err"):
                done = {"status": p["status"],
                        "failedNode": next((m for m in p["flow"]["order"]
                                            if (snap["nodeRuns"].get(m) or {}).get("st") == "err"),
                                           None)}
                yield f"event: done\ndata: {json.dumps(done, ensure_ascii=False)}\n\n"
                break
            await asyncio.sleep(3)

    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache",
                                      "X-Accel-Buffering": "no"})
