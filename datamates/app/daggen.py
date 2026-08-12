"""파이프라인 → Airflow DAG 파일 생성.

파이프라인을 저장할 때마다 dags/datamates_{id}.py 를 새로 쓴다. 생성물이므로
사람이 고치지 않는다는 전제이고, DAG_PREFIX 가 붙은 파일만 건드려서 손으로 만든
DAG(dbt_smoke.py 등)은 절대 지우지 않는다.

실행 순서는 여기서 정하지 않는다 — graph.build() 가 모델의 ref() 관계로 계산한
결과를 태스크 의존성으로 옮겨 적을 뿐이다.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from . import graph
from .config import (CONTAINER_DBT_BIN, CONTAINER_DBT_DIR, DAGS_DIR,
                     DAG_PREFIX)

# 화면의 실행 일정 선택지 → cron. None 이면 예약 없이 수동 실행만 한다.
FREQ_CRON: dict[str, str | None] = {
    "수동 실행": None,
    "1시간마다": "0 * * * *",
    "매일 04:30": "30 4 * * *",
    "매일 05:00": "0 5 * * *",
    "매일 06:00": "0 6 * * *",
    "매주 월 06:00": "0 6 * * 1",
}

# 컨테이너가 dbt 산출물을 쓰는 위치. 호스트의 ./.datamates/runs 에 바인드돼 있어서
# API 가 같은 파일을 읽는다.
CONTAINER_RUNS_DIR = "/opt/datamates/runs"

# 한 파이프라인 안에서 동시에 돌릴 태스크 수.
#
# 1 이어야 한다. Iceberg 카탈로그가 SQLite(apache/iceberg-rest-fixture)라서
# dbt 두 개가 동시에 테이블을 커밋하면 반드시 SQLITE_BUSY 로 깨진다.
# 측정: 순차 3회 연속 = 오류 0건 / 병렬 2개 = 매번 14건.
# busy_timeout·커넥션 풀 축소로는 완화만 될 뿐 없어지지 않는다.
# (가끔 병렬이 성공하는데, 타이밍 운이라 근거로 삼으면 안 된다)
#
# 카탈로그를 Postgres 로 바꾸면 이 값을 올릴 수 있다. 그때 자원 기준으로 다시 잡되,
# colima VM 이 6 CPU / 8GB 이고 태스크마다 Spark JVM 이 하나씩 뜨므로 2~3이 상한이다.
MAX_ACTIVE_TASKS = 1

# 위의 제한은 «한 DAG 안»에서만 통한다. 데이터 수집은 별도 DAG 이라 그것만으로는
# 파이프라인 빌드와 동시에 커밋할 수 있다. DAG 을 가로질러 막는 수단은 풀뿐이라
# 빌드 태스크도 수집과 같은 풀에 넣는다. (ingestdag.POOL 과 같은 값)
POOL = "iceberg_write"

# run_id 에는 ':' 와 '+' 가 들어간다(manual__2026-08-07T02:30:00+00:00).
# 그대로 디렉터리명으로 쓰면 macOS 쪽 파일 공유에서 문제가 되므로 양쪽에서 같은 규칙으로 씻는다.
_SANITIZE = "| replace(':', '-') | replace('+', '-')"


def safe_run_id(run_id: str) -> str:
    """DAG 템플릿의 치환 규칙을 파이썬 쪽에서 동일하게 재현한다."""
    return run_id.replace(":", "-").replace("+", "-")


def dag_id_of(pipeline_id: str) -> str:
    return f"{DAG_PREFIX}{pipeline_id}"


def dag_path_of(pipeline_id: str) -> Path:
    return DAGS_DIR / f"{DAG_PREFIX}{pipeline_id}.py"


def task_id_of(model_id: str) -> str:
    return f"build__{model_id}"


def _bash(select: str, env_target: str) -> str:
    """모델 하나(또는 전체)를 빌드하는 명령.

    `dbt build` 는 run 과 test 를 DAG 순서로 함께 돌리고, 테스트가 실패하면
    하류를 SKIP 한다 — 오염된 데이터가 번지지 않게 하는 기본기다.
    --target-path 를 실행마다 갈라 두어야 run_results.json 이 서로 덮어쓰지 않는다.
    """
    out_dir = f"{CONTAINER_RUNS_DIR}/{{{{ run_id {_SANITIZE} }}}}/{select.replace('+', '')}"
    return (
        f"set -o pipefail; "
        f"mkdir -p '{out_dir}' && "
        f"cd {CONTAINER_DBT_DIR} && "
        f"DBT_TARGET={env_target} "
        f"{CONTAINER_DBT_BIN} build --select {select} "
        f"--target-path '{out_dir}'"
    )


TEMPLATE = '''"""자동 생성 파일 — 직접 고치지 마세요.

Data Mates 파이프라인 {name} 에서 생성했습니다.
파이프라인을 저장하면 이 파일이 통째로 다시 쓰입니다.

실행 대상 : {targets}
실행 순서 : {order}
"""

from datetime import datetime, timedelta

from airflow import DAG
from airflow.providers.standard.operators.bash import BashOperator
from airflow.providers.standard.operators.empty import EmptyOperator
from airflow.sdk import Asset, AssetAny

DEFAULT_ARGS = {{
    "retries": {retry},
    "retry_delay": timedelta(minutes=5),
}}

with DAG(
    dag_id={dag_id!r},
    description={description!r},
    start_date=datetime(2026, 1, 1),
    schedule={schedule_expr},
    catchup=False,
    max_active_runs=1,
    max_active_tasks={max_active_tasks},
    # 실패 처리 «중단» — 한 Task 가 실패하면 실행 중인 나머지도 즉시 세운다.
    # «계속» 이면 여기가 False 이고, 실패한 Task 의 후행만 막히고 옆가지는 간다.
    # 어느 쪽이든 «실패한 Task 에 의존하는 후행은 돌지 않는다» 는 지켜진다 —
    # 그건 각 Task 의 trigger_rule=all_success 가 보장한다.
    fail_fast={fail_fast},
    default_args=DEFAULT_ARGS,
    tags=["datamates", {pipeline_id!r}],
) as dag:

    tasks = {{}}
{task_lines}

    # 파이프라인 완료 표식. 모든 태스크가 성공해야 돌고(all_success),
    # 그때 Asset 이벤트를 내보낸다 — 이 파이프라인을 선행으로 지정한
    # 후행 파이프라인들이 그 이벤트로 시작한다. 하나가 여럿을 깨울 수 있다.
    tasks["_done"] = EmptyOperator(
        task_id="pipeline_done",
        outlets=[Asset({asset_uri!r})],
    )
{dep_lines}
'''


def asset_uri_of(pipeline_id: str) -> str:
    return f"datamates://pipeline/{pipeline_id}"


def model_asset_uri(model_id: str) -> str:
    return f"datamates://model/{model_id}"


def _schedule_expr(pipeline: dict[str, Any], flow: dict[str, Any]) -> str:
    """DAG 의 schedule 인자 — 트리거 방식이 정한다.

    · upstream    선행 파이프라인의 완료 Asset 구독. 선행 DAG 의 pipeline_done
                  태스크가 all_success 라서, 하나라도 실패하면 이벤트가 없고
                  후행은 돌지 않는다 — 성공 시 실행이 조건이 아니라 구조다.
    · data_event  입력 데이터의 Asset 구독 — 조회 전용 입력 모델과 원천
                  CSV(seed). 소유 파이프라인의 태스크 성공 또는 원천 다시
                  적재가 이벤트를 낸다. 여럿이면 하나만 갱신돼도 실행(AssetAny).
    """
    t = pipeline.get("trigger_type") or "schedule"
    if t == "manual":
        return repr(None)
    if t == "upstream" and pipeline.get("upstream_pipeline_id"):
        return f"[Asset({asset_uri_of(pipeline['upstream_pipeline_id'])!r})]"
    if t == "data_event":
        watch = data_event_watch(flow)
        if watch:
            uris = ", ".join(f"Asset({model_asset_uri(m)!r})" for m in watch)
            # 여럿이면 «하나만 갱신돼도» 실행한다(AssetAny). 기본(AND)으로 두면
            # 원천 하나만 고쳤을 때 영원히 돌지 않는다.
            return f"AssetAny({uris})" if len(watch) > 1 else f"[{uris}]"
    return repr(FREQ_CRON.get(pipeline.get("freq") or "수동 실행"))


# 갱신 이벤트를 내는 카탈로그 항목의 dbt 종류.
#   model  — 소유 파이프라인의 빌드 태스크가 outlets 로 낸다
#   seed   — 카탈로그의 다시 적재가 성공하면 API 가 직접 낸다(airflow_client.asset_event)
#   source — 데이터 수집이 적재하면 수집 DAG 이 outlets 로 낸다
#
# source 는 종류만으로 판단하면 안 된다. 플랫폼이 적재하지 않는 외부 테이블은
# 이벤트를 낼 사람이 없어서, 그것만 감시하는 파이프라인은 영영 돌지 않는다.
# 그래서 «수집 작업이 대상으로 삼은 source» 만 감시 대상에 넣는다.
_EVENT_KINDS = ("seed",)


def data_event_watch(flow: dict[str, Any]) -> list[str]:
    """데이터 이벤트가 감시할 입력들.

    · 조회 전용 입력 — 소유 파이프라인에서 그 모델 태스크가 성공할 때
    · 원천 CSV(seed) — 카탈로그의 다시 적재가 성공할 때
    · 원천 테이블(source) — 데이터 수집이 적재했을 때. 수집이 맡은 것만이다.
    """
    from . import store
    ingested = {j["target"] for j in store.ingest_jobs()}

    watch = list(flow.get("inputs") or [])
    for nd in flow.get("nodes") or []:
        rtype = nd.get("dbt_type")
        if nd["id"] in watch:
            continue
        if rtype in _EVENT_KINDS or (rtype == "source" and nd["id"] in ingested):
            watch.append(nd["id"])
    return watch


def render(pipeline: dict[str, Any], flow: dict[str, Any]) -> str:
    pid = pipeline["id"]
    order: list[str] = flow["order"]
    env_target = pipeline.get("env") or "local"

    # **Task 그래프를 그대로 옮긴다.** 예전에는 여기서 모델 간선을 다시 걸러
    # 태스크 의존을 만들었는데, 화면은 화면대로 같은 일을 따로 해서 둘이 어긋날
    # 자리가 있었다(특히 task_mode=single 은 화면에 열두 칸, DAG 에 태스크 하나).
    # graph.tasks_of 하나가 정본이고 화면과 DAG 이 그것을 함께 읽는다.
    tasks_spec: list[dict[str, Any]] = flow.get("tasks") or []
    task_edges: list[dict[str, str]] = flow.get("task_edges") or []

    lines: list[str] = []
    deps: list[str] = []

    for t in tasks_spec:
        if t["kind"] != "build":
            continue                      # 완료 표식은 템플릿이 이미 만든다
        models = t["models"]
        outlets = ", ".join(f"Asset({model_asset_uri(m)!r})" for m in models)
        lines.append(
            f'    tasks[{t["key"]!r}] = BashOperator(\n'
            f'        task_id={("build__all" if t["key"] == "all" else task_id_of(t["key"]))!r},\n'
            # **선행이 실패하면 후행은 돌지 않는다.** 예외를 두지 않는다 —
            # 상류가 실패한 채로 하류를 돌리면 옛 데이터 위에 새 결과가 얹혀
            # 「성공한 파이프라인」이 틀린 값을 남긴다. 옆가지는 그대로 진행되므로
            # (Airflow 의 기본 동작) 실패가 무관한 Task 까지 막지는 않는다.
            f'        trigger_rule="all_success",\n'
            f'        bash_command={_bash(" ".join(models), env_target)!r},\n'
            f'        pool={POOL!r},\n'
            f'        outlets=[{outlets}],\n'
            f'    )'
        )

    for e in task_edges:
        a = '"_done"' if e["to"] == graph.DONE_TASK else repr(e["to"])
        deps.append(f'    tasks[{e["from"]!r}] >> tasks[{a}]')

    if not tasks_spec:                    # 실행할 모델이 없는 파이프라인
        lines.append(
            f'    tasks["all"] = BashOperator(\n'
            f'        task_id="build__all",\n'
            f'        trigger_rule="all_success",\n'
            f'        bash_command={_bash("state:new", env_target)!r},\n'
            f'        pool={POOL!r},\n'
            f'    )'
        )
        deps.append('    tasks["all"] >> tasks["_done"]')

    return TEMPLATE.format(
        name=pipeline.get("name") or pid,
        targets=", ".join(pipeline.get("targets") or []) or "(없음)",
        order=" → ".join(order) or "(없음)",
        dag_id=dag_id_of(pid),
        description=(pipeline.get("description") or pipeline.get("name") or pid),
        schedule_expr=_schedule_expr(pipeline, flow),
        asset_uri=asset_uri_of(pid),
        max_active_tasks=MAX_ACTIVE_TASKS,
        fail_fast=(pipeline.get("on_fail") != "go"),
        retry=int(pipeline.get("retry") or 0),
        pipeline_id=pid,
        task_lines="\n\n".join(lines),
        dep_lines=("\n" + "\n".join(deps) + "\n") if deps else "",
    )


def write(pipeline: dict[str, Any], flow: dict[str, Any]) -> Path:
    DAGS_DIR.mkdir(parents=True, exist_ok=True)
    path = dag_path_of(pipeline["id"])
    path.write_text(render(pipeline, flow))
    return path


def remove(pipeline_id: str) -> bool:
    path = dag_path_of(pipeline_id)
    if path.exists():
        path.unlink()
        return True
    return False


def run_results_dir(pipeline_id: str, run_id: str) -> Path:
    from .config import DATA_DIR
    return DATA_DIR / "runs" / safe_run_id(run_id)


def read_run_results(pipeline_id: str, run_id: str) -> dict[str, dict[str, Any]]:
    """실행 산출물에서 모델별 결과를 모은다.

    Airflow 의 태스크 상태는 성공/실패만 알려준다. 처리 행수·소요·테스트 결과는
    dbt 가 쓴 run_results.json 에만 있어서 이쪽을 함께 읽는다.
    태스크가 여럿이면 디렉터리도 여럿이라 전부 훑어 합친다.
    """
    base = run_results_dir(pipeline_id, run_id)
    out: dict[str, dict[str, Any]] = {}
    if not base.exists():
        return out
    for rr in sorted(base.glob("*/run_results.json")):
        try:
            data = json.loads(rr.read_text())
        except (json.JSONDecodeError, OSError):
            continue
        for res in data.get("results", []):
            uid = res.get("unique_id") or ""
            parts = uid.split(".")
            if len(parts) < 3:
                continue
            kind, name = parts[0], parts[-1]
            entry = out.setdefault(name if kind in ("model", "seed") else uid, {})
            entry.update({
                "unique_id": uid,
                "resource_type": kind,
                "status": res.get("status"),
                "execution_time": res.get("execution_time"),
                "message": res.get("message"),
                "rows_affected": (res.get("adapter_response") or {}).get("rows_affected"),
                "failures": res.get("failures"),
            })
    return out
