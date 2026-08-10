"""화면이 공유하는 파생 상태 — 카탈로그 · 품질 규칙 · 실행 결과를 한곳에서 계산한다.

홈 · 카탈로그 · 품질 · 파이프라인 화면은 결국 같은 사실을 다르게 자른 것이다.
그 계산을 라우터마다 따로 두면 홈은 실패 2건인데 품질 화면은 1건 같은 어긋남이 생긴다.
"""

from __future__ import annotations

import time
from typing import Any

from . import airflow_client as af
from . import daggen, graph, manifest, store

# 파이프라인 실행 결과는 Airflow + dbt 산출물을 함께 읽어야 해서 비싸다.
# 화면 하나 그리는 동안 여러 라우터가 같은 값을 물으므로 짧게 캐시한다.
_TTL = 3.0
_cache: dict[str, Any] = {"at": 0.0, "data": None}

# dbt 테스트 이름 → 화면의 검사 유형(설계서 8.1 rule-types)
QTYPES = {
    "notnull": {"key": "notnull", "label": "필수값", "dbt": "not_null"},
    "unique": {"key": "unique", "label": "중복", "dbt": "unique"},
    "accepted": {"key": "accepted", "label": "허용값", "dbt": "accepted_values"},
    "rel": {"key": "rel", "label": "참조 무결성", "dbt": "relationships"},
    "range": {"key": "range", "label": "범위", "dbt": "dbt_utils.accepted_range"},
    "fresh": {"key": "fresh", "label": "최신성", "dbt": "source freshness"},
    "sql": {"key": "sql", "label": "사용자 정의 SQL", "dbt": "singular test"},
}


def qtype_of(dbt_name: str) -> str:
    n = (dbt_name or "").replace("dbt_utils.", "")
    if n == "not_null":
        return "notnull"
    if n in ("unique", "unique_combination_of_columns"):
        return "unique"
    if n == "accepted_values":
        return "accepted"
    if n == "relationships":
        return "rel"
    if n == "accepted_range":
        return "range"
    if "freshness" in n:
        return "fresh"
    return "sql"


def invalidate() -> None:
    _cache.update(at=0.0, data=None)


def snapshot(force: bool = False) -> dict[str, Any]:
    """파이프라인별 최신 실행 + 모델별 실행 결과 + 테스트별 결과."""
    now = time.time()
    if not force and _cache["data"] is not None and now - _cache["at"] < _TTL:
        return _cache["data"]

    pipes: list[dict[str, Any]] = []
    node_runs: dict[str, dict[str, Any]] = {}      # model_id → 최근 실행 결과
    test_results: dict[str, dict[str, Any]] = {}   # test unique_id → 결과
    airflow_ok = True

    all_pipes = store.pipelines()
    owner = graph.ownership(all_pipes)
    for p in all_pipes:
        flow = graph.flow_for(p, all_pipes, owner)
        dag_id = daggen.dag_id_of(p["id"])
        latest = None
        try:
            runs = af.dag_runs(dag_id, limit=1)
            if runs:
                run_id = runs[0]["dag_run_id"]
                results = daggen.read_run_results(p["id"], run_id)
                tis = {t["task_id"]: t for t in af.task_instances(dag_id, run_id)}
                latest = {"runId": run_id, "status": _run_state(runs[0].get("state")),
                          "startedAt": runs[0].get("start_date"),
                          "endedAt": runs[0].get("end_date")}
                for rr in results.values():
                    if rr.get("resource_type") == "test":
                        test_results[rr["unique_id"]] = rr
                failed_uids = {uid for uid, r2 in results.items()
                               if r2.get("resource_type") == "test"
                               and r2.get("status") in ("fail", "error")}
                entries = manifest.all_entries()
                for mid in flow["order"]:
                    task_id = ("build__all" if p["task_mode"] == "single"
                               else daggen.task_id_of(mid))
                    ti = tis.get(task_id, {})
                    rr = results.get(mid, {})
                    tf = any(t["unique_id"] in failed_uids
                             for t in entries.get(mid, {}).get("tests", []))
                    node_runs.setdefault(mid, {
                        "st": node_state(rr.get("status"), ti.get("state"), tf),
                        "dur": rr.get("execution_time"),
                        "rows": rr.get("rows_affected"),
                        "pipelineId": p["id"], "runId": run_id,
                        "tryNumber": ti.get("try_number", 1),
                    })
        except af.AirflowError:
            airflow_ok = False      # Airflow 가 없어도 카탈로그·모델 화면은 떠야 한다

        # 일시정지 여부는 Airflow 가 들고 있다. 메타스토어에 따로 두면
        # Airflow UI 에서 끈 것과 화면이 어긋난다.
        paused = None
        next_run = None
        try:
            d = af.dag_get(dag_id)
            if d:
                paused = bool(d.get("is_paused"))
                # 다음 예정 시각은 Airflow 가 계산한다(cron·타임존·catchup 반영).
                # 예약이 아닌 트리거(수동·선행·데이터 이벤트)는 값이 없다 — 정상이다.
                next_run = d.get("next_dagrun_run_after") or d.get("next_dagrun_logical_date")
        except af.AirflowError:
            airflow_ok = False

        pipes.append({**p, "dagId": dag_id, "cron": daggen.FREQ_CRON.get(p["freq"]),
                      "flow": flow, "latestRun": latest,
                      "status": latest["status"] if latest else "wait",
                      "paused": paused, "nextRun": next_run,
                      "modelCount": len(flow["order"])})

    data = {"pipelines": pipes, "nodeRuns": node_runs, "testResults": test_results,
            "airflowOk": airflow_ok, "at": now}
    _cache.update(at=now, data=data)
    return data


def _run_state(s: str | None) -> str:
    return {"success": "ok", "failed": "err", "running": "run",
            "queued": "wait"}.get(s or "", "wait")


# Airflow 태스크 상태 → 화면 상태. (실행 상세 API 도 같은 표를 쓴다)
# upstream_failed 를 «건너뜀» 으로 보는 게 핵심이다 — 그 모델이 실패한 게 아니라
# 앞이 실패해서 돌지 않은 것이고, 화면은 이 둘을 구분해서 보여준다.
TASK_STATE = {
    "success": "ok", "failed": "err", "upstream_failed": "skip", "skipped": "skip",
    "running": "run", "restarting": "run", "up_for_retry": "run", "deferred": "run",
    "queued": "wait", "scheduled": "wait", "none": "wait", None: "wait",
    "removed": "wait", "up_for_reschedule": "wait",
}


def node_state(dbt_status: str | None, af_state: str | None,
               test_failed: bool = False) -> str:
    """모델 노드 하나의 화면 상태. dbt 결과가 있으면 그쪽이 정확하다.

    태스크는 성공인데 모델은 error 인 경우(테스트 실패로 이후 SKIP)를
    Airflow 상태만으로는 구분할 수 없다.

    test_failed — 그 모델에 매달린 테스트에 실패(fail/error)가 있는가.
    run_results 는 모델과 테스트를 별개 노드로 적어서, 모델 status 만 보면
    테이블 생성이 성공한 모델은 테스트가 깨져도 ok 로 보인다. 그대로 두면
    파이프라인은 빨간데 그걸 실패시킨 모델만 초록으로 남는다.
    """
    if dbt_status in ("error", "fail"):
        return "err"
    if dbt_status == "skipped":
        return "skip"
    if dbt_status in ("success", "pass"):
        return "err" if test_failed else "ok"
    return TASK_STATE.get(af_state, "wait")


# ---------------------------------------------------------------- 품질 규칙

def rules() -> list[dict[str, Any]]:
    """품질 규칙 = dbt 테스트 + 최근 실행 결과.

    설계서 8장의 단일 리소스 원칙대로, 모델 화면의 품질 규칙 탭과
    품질 화면이 이 목록 하나를 함께 본다.
    """
    snap = snapshot()
    tr = snap["testResults"]
    entries = manifest.all_entries()
    seen: set[str] = set()
    out: list[dict[str, Any]] = []

    for e in entries.values():
        for t in e["tests"]:
            key = t["unique_id"] + "@" + e["id"]
            if key in seen:
                continue
            seen.add(key)
            rr = tr.get(t["unique_id"]) or {}
            st = "" if not t.get("enabled", True) else (rr.get("status") or "").lower()
            status = ("ok" if st in ("pass", "success")
                      else "warn" if st == "warn"
                      else "err" if st in ("fail", "error") else "unknown")
            failures = rr.get("failures")
            qt = qtype_of(t["type"])
            kw = t.get("kwargs") or {}
            cond = t["type"] + (" " + _kw_text(kw) if kw else "")
            out.append({
                "id": t["name"],                # dbt 테스트 이름 = 규칙 id
                "uniqueId": t["unique_id"],
                "name": (f"{QTYPES[qt]['label']} · {t['col']}" if t["col"]
                         else QTYPES[qt]["label"]),
                "type": qt, "modelId": e["id"], "col": t["col"], "cond": cond,
                "sev": "error" if t["severity"] == "error" else "warn",
                "active": t.get("enabled", True),
                "status": status,
                "cnt": int(failures) if isinstance(failures, (int, float)) else 0,
                "plain": _plain(status, failures, t, e),
                "impact": "", "rows": [],
                "lastRun": "최근 실행" if rr else "실행 전",
                "firstSeen": "—",
                "pipelineId": (snap["nodeRuns"].get(e["id"]) or {}).get("pipelineId"),
                "singular": t.get("singular", False),
            })
    return out


def _kw_text(kw: dict[str, Any]) -> str:
    parts = []
    for k, v in kw.items():
        if isinstance(v, list):
            v = ", ".join(str(x) for x in v[:6])
        parts.append(f"{k}={v}")
    return "(" + " · ".join(parts) + ")"


def _plain(status: str, failures: Any, t: dict[str, Any], e: dict[str, Any]) -> str:
    col = t["col"] or "이 모델"
    if status == "ok":
        return f"{e['name']} 의 {col} 은(는) 검사를 통과했습니다."
    if status == "unknown":
        return "아직 검사하지 않았습니다. 파이프라인을 한 번 실행하면 결과가 채워집니다."
    n = int(failures) if isinstance(failures, (int, float)) else 0
    label = "주의" if status == "warn" else "실패"
    return f"{e['name']} 의 {col} 에서 {label} {n}건이 확인되었습니다."


def quality_of(model_id: str, rs: list[dict[str, Any]] | None = None) -> str:
    """모델의 품질 상태 = 활성 규칙 집계 (설계서 5.1)."""
    rs = rs if rs is not None else rules()
    mine = [r for r in rs if r["modelId"] == model_id and r["active"]]
    if any(r["status"] == "err" for r in mine):
        return "err"
    if any(r["status"] == "warn" for r in mine):
        return "warn"
    return "ok"
