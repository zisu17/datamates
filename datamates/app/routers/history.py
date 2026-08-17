"""실행 이력 통계 — Elementary 테이블을 직접 집계한다.

**여기서 말하는 실행은 dbt invocation 이다.** Airflow 의 DAG 실행과 1:1이 아니다.
task_mode 가 per_model 이면 파이프라인 한 번에 모델 수만큼 invocation 이 생긴다.
파이프라인 단위 이력은 /pipelines/{id}/runs 쪽이고, 여기는 무엇이 얼마나 걸렸나를
모델·테스트 단위로 본다.

조회는 DuckDB 로 Iceberg 카탈로그에 직접 붙는다(warehouse.py). Spark 를 거치면
집계 하나에 15초가 들어 화면에서 쓸 수 없다.

주의 — Elementary 의 시각 컬럼은 VARCHAR 로 적재된다. 비교·정렬 전에 캐스팅해야
문자열 비교가 되어 조용히 틀린 결과가 나온다.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Query

from .. import manifest, warehouse
from ..errors import not_found

router = APIRouter(prefix="/history", tags=["history"])

EL = "ice.analytics_elementary"

# 시각 컬럼은 VARCHAR 다. 매번 쓰기 번거로워 표현을 하나로 모은다.
#
# **오프셋이 붙어 있으므로 그대로 읽는다.** 예전에는
# `CAST(... AS TIMESTAMP) AT TIME ZONE 'UTC'` 였다 — 시간대 표시가 없는 UTC
# 문자열이라는 전제였는데, 실제 값은 `2026-08-14T16:47:18+09:00` 처럼 오프셋을
# 달고 온다. TIMESTAMP 로 캐스팅하는 순간 그 +09:00 이 잘려 나가고, 남은 naive
# 값을 다시 UTC 로 선언하니 **모든 시각이 9시간 뒤로 밀렸다.**
# (증상: 오늘 16:47 의 검사가 내일 01:47 로 잡혀 일자별 추이에 «내일» 이 생겼다.)
#
# TIMESTAMPTZ 로 캐스팅하면 오프셋이 있으면 그것을, 없으면 세션 시간대를 쓴다 —
# 두 형태가 섞여 들어와도 맞는 순간을 가리킨다.
TS = "(CAST({} AS TIMESTAMPTZ))"
# execution_time 은 FLOAT 라 그대로 반올림하면 17.9 가 17.90999984741211 로 나온다.
SEC = "CAST({} AS DOUBLE)"


def _since(days: int) -> str:
    """DuckDB 는 INTERVAL 에 파라미터를 직접 못 받는다. 정수만 받아 문자열로 만든다."""
    return f"(now() - INTERVAL '{int(days)} day')"


def _rows(sql: str, params: list[Any] | None = None) -> list[dict[str, Any]]:
    out = warehouse.query(sql, params)
    return [dict(zip(out["columns"], r)) for r in out["rows"]]


def _one(sql: str, params: list[Any] | None = None) -> dict[str, Any]:
    rs = _rows(sql, params)
    return rs[0] if rs else {}


# ---------------------------------------------------------------- 요약

@router.get("/summary")
def summary(days: int = Query(30, ge=1, le=365)) -> dict[str, Any]:
    since = _since(days)
    inv = _one(f"""
        select count(*) runs,
               min({TS.format('run_started_at')}) firstRun,
               max({TS.format('run_started_at')}) lastRun,
               count(distinct command) commands
        from {EL}.dbt_invocations
        where {TS.format('run_started_at')} >= {since}""")

    node = _one(f"""
        select
          count(*) filter (where resource_type in ('model','seed','snapshot')) nodeRuns,
          count(*) filter (where resource_type in ('model','seed','snapshot')
                             and status not in ('success','pass')) nodeFails,
          round(sum(CAST(execution_time AS DOUBLE)) filter (where resource_type in ('model','seed','snapshot')), 1) buildSeconds,
          count(*) filter (where resource_type in ('test','unit_test')) testRuns,
          count(*) filter (where resource_type in ('test','unit_test') and status = 'pass') testPass,
          count(*) filter (where resource_type in ('test','unit_test') and status = 'warn') testWarn,
          count(*) filter (where resource_type in ('test','unit_test')
                             and status in ('fail','error')) testFail
        from {EL}.dbt_run_results
        where {TS.format('generated_at')} >= {since}""")

    nr, nf = node.get("nodeRuns") or 0, node.get("nodeFails") or 0
    tr, tp = node.get("testRuns") or 0, node.get("testPass") or 0
    return {
        "days": days,
        "runs": inv.get("runs") or 0,
        "firstRun": inv.get("firstRun"), "lastRun": inv.get("lastRun"),
        "nodeRuns": nr, "nodeFails": nf,
        "successRate": round((nr - nf) / nr * 100, 1) if nr else None,
        "buildSeconds": node.get("buildSeconds"),
        "test": {"runs": tr, "pass": tp,
                 "warn": node.get("testWarn") or 0,
                 "fail": node.get("testFail") or 0,
                 "passRate": round(tp / tr * 100, 1) if tr else None},
        "note": "실행은 dbt invocation 단위입니다. 파이프라인 한 번에 여러 번 생길 수 있습니다.",
    }


# ---------------------------------------------------------------- 실행 목록

@router.get("/runs")
def runs(days: int = Query(30, ge=1, le=365),
         limit: int = Query(50, ge=1, le=500),
         command: str | None = None) -> dict[str, Any]:
    """dbt 실행 목록 — 무엇을 어떤 설정으로 돌렸나."""
    cond = f"where {TS.format('i.run_started_at')} >= {_since(days)}"
    params: list[Any] = []
    if command:
        cond += " and i.command = ?"
        params.append(command)
    items = _rows(f"""
        select i.invocation_id invocationId, i.command, i.dbt_version dbtVersion,
               i.target_name targetName, i.target_schema targetSchema,
               i.threads, i.full_refresh fullRefresh, i.selected, i.vars,
               i.dbt_user dbtUser, i.orchestrator,
               {TS.format('i.run_started_at')} startedAt,
               {TS.format('i.run_completed_at')} completedAt,
               round(date_diff('millisecond', {TS.format('i.run_started_at')},
                               {TS.format('i.run_completed_at')}) / 1000.0, 1) wallSeconds,
               count(r.unique_id) nodes,
               count(*) filter (where r.status not in ('success','pass')) fails,
               round(sum(CAST(r.execution_time AS DOUBLE)), 2) execSeconds
        from {EL}.dbt_invocations i
        left join {EL}.dbt_run_results r on r.invocation_id = i.invocation_id
        {cond}
        group by all
        order by startedAt desc
        limit {int(limit)}""", params)
    return {"items": items, "total": len(items)}


@router.get("/runs/{invocation_id}")
def run_detail(invocation_id: str) -> dict[str, Any]:
    """실행 1건 — 노드별 결과. compile / execute 구간을 나눠 어디서 시간이 갔는지 본다."""
    head = _one(f"""
        select invocation_id invocationId, command, dbt_version dbtVersion,
               target_name targetName, threads, full_refresh fullRefresh,
               selected, vars, dbt_user dbtUser,
               {TS.format('run_started_at')} startedAt,
               {TS.format('run_completed_at')} completedAt
        from {EL}.dbt_invocations where invocation_id = ?""", [invocation_id])
    if not head:
        raise not_found(invocation_id)
    nodes = _rows(f"""
        select name, unique_id uniqueId, resource_type resourceType, status,
               round(CAST(execution_time AS DOUBLE), 3) executionTime,
               round(date_diff('millisecond', {TS.format('compile_started_at')},
                     {TS.format('compile_completed_at')}) / 1000.0, 3) compileSeconds,
               round(date_diff('millisecond', {TS.format('execute_started_at')},
                     {TS.format('execute_completed_at')}) / 1000.0, 3) executeSeconds,
               rows_affected rowsAffected, materialization, failures, message, thread_id threadId
        from {EL}.dbt_run_results
        where invocation_id = ?
        order by execution_time desc nulls last""", [invocation_id])
    return {**head, "nodes": nodes, "nodeCount": len(nodes)}


# ---------------------------------------------------------------- 모델별

@router.get("/models")
def models(days: int = Query(30, ge=1, le=365),
           limit: int = Query(100, ge=1, le=500)) -> dict[str, Any]:
    """모델별 실행 통계 — 평균만 보면 가끔 튀는 모델을 놓쳐서 p95 와 max 를 함께 준다."""
    items = _rows(f"""
        select name, unique_id uniqueId, resource_type resourceType,
               count(*) runs,
               count(*) filter (where status not in ('success','pass')) fails,
               round(avg(CAST(execution_time AS DOUBLE)), 2) avgSeconds,
               round(quantile_cont(CAST(execution_time AS DOUBLE), 0.5), 2) p50Seconds,
               round(quantile_cont(CAST(execution_time AS DOUBLE), 0.95), 2) p95Seconds,
               round(max(CAST(execution_time AS DOUBLE)), 2) maxSeconds,
               round(sum(CAST(execution_time AS DOUBLE)), 1) totalSeconds,
               max({TS.format('generated_at')}) lastRunAt,
               max(materialization) materialization
        from {EL}.dbt_run_results
        where {TS.format('generated_at')} >= {_since(days)}
          and resource_type in ('model','seed','snapshot')
        group by all
        order by totalSeconds desc
        limit {int(limit)}""")
    entries = manifest.all_entries()
    for i in items:
        e = entries.get(i["name"])
        i["exists"] = e is not None          # 지워진 모델의 이력도 남아 있다
        i["phys"] = e["phys"] if e else None
        i["failRate"] = round((i["fails"] or 0) / i["runs"] * 100, 1) if i["runs"] else 0
    return {"items": items, "total": len(items), "days": days}


@router.get("/models/{model_id}")
def model_history(model_id: str,
                  days: int = Query(30, ge=1, le=365),
                  limit: int = Query(100, ge=1, le=500)) -> dict[str, Any]:
    """모델 1개의 실행 시계열. 느려지는 추세를 보려는 용도다."""
    if not manifest.get(model_id):
        raise not_found(model_id)
    items = _rows(f"""
        select {TS.format('generated_at')} ranAt, status,
               round(CAST(execution_time AS DOUBLE), 3) executionTime,
               round(date_diff('millisecond', {TS.format('compile_started_at')},
                     {TS.format('compile_completed_at')}) / 1000.0, 3) compileSeconds,
               round(date_diff('millisecond', {TS.format('execute_started_at')},
                     {TS.format('execute_completed_at')}) / 1000.0, 3) executeSeconds,
               rows_affected rowsAffected, materialization, full_refresh fullRefresh,
               invocation_id invocationId, message
        from {EL}.dbt_run_results
        where name = ? and {TS.format('generated_at')} >= {_since(days)}
        order by ranAt desc
        limit {int(limit)}""", [model_id])
    return {"modelId": model_id, "items": items, "total": len(items), "days": days}


# ---------------------------------------------------------------- 추이 · 순위

@router.get("/daily")
def daily(days: int = Query(14, ge=1, le=365)) -> dict[str, Any]:
    """일자별 추이. 실행이 없는 날은 항목을 만들지 않는다 — 0으로 채우면 전부 실패로 읽힌다."""
    items = _rows(f"""
        select cast({TS.format('generated_at')} as date) date,
               count(*) filter (where resource_type in ('model','seed','snapshot')) nodeRuns,
               count(*) filter (where resource_type in ('model','seed','snapshot')
                                  and status not in ('success','pass')) nodeFails,
               round(sum(CAST(execution_time AS DOUBLE)) filter
                     (where resource_type in ('model','seed','snapshot')), 1) buildSeconds,
               count(*) filter (where resource_type in ('test','unit_test')) testRuns,
               count(*) filter (where resource_type in ('test','unit_test')
                                  and status = 'pass') testPass,
               count(distinct invocation_id) invocations
        from {EL}.dbt_run_results
        where {TS.format('generated_at')} >= {_since(days)}
        group by 1 order by 1""")
    for d in items:
        nr, nf = d["nodeRuns"] or 0, d["nodeFails"] or 0
        tr, tp = d["testRuns"] or 0, d["testPass"] or 0
        d["successRate"] = round((nr - nf) / nr * 100, 1) if nr else None
        d["testPassRate"] = round(tp / tr * 100, 1) if tr else None
    return {"items": items, "total": len(items), "days": days}


@router.get("/slowest")
def slowest(days: int = Query(30, ge=1, le=365),
            limit: int = Query(10, ge=1, le=100)) -> dict[str, Any]:
    """느린 모델 순위 — 총 소요 기준. 한 번 느린 것보다 자주 × 느린 것이 먼저다.

    동점일 때는 이름으로 끊는다. 기준이 없으면 소요가 같은 모델들의 순서가 실행마다
    달라지고, limit 로 자르는 자리에서는 «어제는 있던 모델이 오늘은 없는» 목록이 된다.
    """
    items = _rows(f"""
        select name, count(*) runs,
               round(sum(CAST(execution_time AS DOUBLE)), 1) totalSeconds,
               round(avg(CAST(execution_time AS DOUBLE)), 2) avgSeconds,
               round(max(CAST(execution_time AS DOUBLE)), 2) maxSeconds
        from {EL}.dbt_run_results
        where {TS.format('generated_at')} >= {_since(days)}
          and resource_type in ('model','seed','snapshot')
        group by 1 order by totalSeconds desc, name limit {int(limit)}""")
    total = sum(i["totalSeconds"] or 0 for i in items)
    for i in items:
        i["share"] = round((i["totalSeconds"] or 0) / total * 100, 1) if total else 0
    return {"items": items, "total": len(items), "days": days}


@router.get("/failures")
def failures(days: int = Query(30, ge=1, le=365),
             limit: int = Query(50, ge=1, le=200)) -> dict[str, Any]:
    """최근 실패 — 모델과 테스트를 한 줄기로 본다. 원인을 좇을 때 둘을 오가야 하므로."""
    items = _rows(f"""
        select {TS.format('generated_at')} ranAt, name, unique_id uniqueId,
               resource_type resourceType, status, failures,
               round(CAST(execution_time AS DOUBLE), 2) executionTime, message,
               invocation_id invocationId
        from {EL}.dbt_run_results
        where {TS.format('generated_at')} >= {_since(days)}
          and status in ('error','fail','warn','skipped')
        order by ranAt desc limit {int(limit)}""")
    return {"items": items, "total": len(items), "days": days}


# ---------------------------------------------------------------- 테스트

@router.get("/tests")
def tests(days: int = Query(30, ge=1, le=365),
          limit: int = Query(200, ge=1, le=500)) -> dict[str, Any]:
    """규칙별 검사 이력 — 통과율과 마지막 실패 시각.

    elementary_test_results 는 dbt_run_results 보다 정보가 많다
    (컬럼명·심각도·위반 행수). 규칙 화면이 쓰기 좋은 쪽이다.
    """
    items = _rows(f"""
        select test_unique_id testUniqueId, test_name testName,
               max(model_unique_id) modelUniqueId, max(table_name) tableName,
               max(column_name) columnName, max(test_type) testType,
               max(severity) severity,
               count(*) runs,
               count(*) filter (where status = 'pass') passes,
               count(*) filter (where status = 'warn') warns,
               count(*) filter (where status in ('fail','error')) fails,
               max(failures) maxFailures,
               max({TS.format('detected_at')}) lastRunAt,
               max({TS.format('detected_at')}) filter
                   (where status in ('fail','error','warn')) lastIssueAt
        from {EL}.elementary_test_results
        where {TS.format('detected_at')} >= {_since(days)}
        group by all
        order by fails desc, warns desc, runs desc
        limit {int(limit)}""")
    for t in items:
        t["passRate"] = round((t["passes"] or 0) / t["runs"] * 100, 1) if t["runs"] else None
    return {"items": items, "total": len(items), "days": days}


@router.get("/tests/daily")
def tests_daily(days: int = Query(14, ge=1, le=365)) -> dict[str, Any]:
    items = _rows(f"""
        select cast({TS.format('detected_at')} as date) date,
               count(*) runs,
               count(*) filter (where status = 'pass') passes,
               count(*) filter (where status = 'warn') warns,
               count(*) filter (where status in ('fail','error')) fails
        from {EL}.elementary_test_results
        where {TS.format('detected_at')} >= {_since(days)}
        group by 1 order by 1""")
    for d in items:
        d["passRate"] = round((d["passes"] or 0) / d["runs"] * 100, 1) if d["runs"] else None
    return {"items": items, "total": len(items), "days": days}


# 정적 경로(/tests/daily)보다 뒤에 둔다 — FastAPI 는 선언 순서로 맞추므로
# 이 규칙이 앞에 오면 daily 가 test_name 으로 잡힌다.
@router.get("/tests/{test_name}")
def test_history(test_name: str,
                 days: int = Query(30, ge=1, le=365),
                 limit: int = Query(100, ge=1, le=500)) -> dict[str, Any]:
    """규칙 1개의 실행 시계열. /models/{model_id} 와 같은 구조다.

    /tests 는 규칙별로 **묶은** 값(기간 통과율·최근 실행)을 주는데, 품질 화면의
    규칙 상세 「실행 이력」 탭은 실행 한 줄씩이 필요하다. 같은 테이블을 묶지 않고
    읽는다.

    없는 이름이어도 404 를 내지 않는다. 규칙을 지워도 이력은 남으므로 «지운 규칙의
    이력 조회» 가 정상 요청이다 — 모델과 달리 지금 존재하는지가 조건이 아니다.
    """
    items = _rows(f"""
        select {TS.format('detected_at')} ranAt, status, failures, severity,
               test_type testType, table_name tableName, column_name columnName,
               test_unique_id testUniqueId
        from {EL}.elementary_test_results
        where test_name = ? and {TS.format('detected_at')} >= {_since(days)}
        order by ranAt desc
        limit {int(limit)}""", [test_name])
    return {"testName": test_name, "items": items, "total": len(items), "days": days}
