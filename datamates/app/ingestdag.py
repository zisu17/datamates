"""데이터 수집 작업 → Airflow DAG 파일 생성.

역할 분담이 파이프라인 DAG 과 다르다. 파이프라인은 컨테이너 안에서 dbt 를
직접 돌리지만, 수집은 **적재를 Data Mates API 에 시킨다**. 적재 엔진(pyiceberg)이
API 쪽에만 있고, 같은 코드를 컨테이너에 한 벌 더 두면 미리보기와 실제 적재가
서로 다르게 동작할 여지가 생기기 때문이다. Airflow 가 맡는 것은 세 가지다 —
언제 돌릴지, 동시에 돌지 않게 잡아두는 것, 끝났다고 알리는 것.

끝났다는 알림은 코드가 아니라 선언이다. outlets 에 적힌 Asset 이 태스크 성공
시점에 자동으로 발행되고, 그 원천을 쓰는 파이프라인이 그걸 보고 깨어난다.
행이 0이면 태스크를 건너뛰어(skip) 이벤트가 나가지 않는다.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from .config import CONTAINER_API_BASE, DAGS_DIR, DAG_PREFIX
from .daggen import POOL, FREQ_CRON, model_asset_uri

# 수집 DAG 도 파이프라인과 같은 접두사를 쓴다. 수집 작업 id 가 ing 으로,
# 파이프라인 id 가 pl 로 시작해서 그것만으로 구분된다.
ING_PREFIX = DAG_PREFIX

# 적재 요청은 오래 걸릴 수 있다(원격 API 응답 + Iceberg 커밋).
REQUEST_TIMEOUT = 900


def dag_id_of(job_id: str) -> str:
    return f"{ING_PREFIX}{job_id}"


def dag_path_of(job_id: str) -> Path:
    return DAGS_DIR / f"{ING_PREFIX}{job_id}.py"


TEMPLATE = '''"""자동 생성 파일 — 직접 고치지 마세요.

Data Mates 데이터 수집 {name} 에서 생성했습니다.
수집 작업을 저장하면 이 파일이 통째로 다시 쓰입니다.

적재 대상 : {target_full}
적재 방식 : {mode_label}
"""

from datetime import datetime, timedelta

from airflow import DAG
from airflow.exceptions import AirflowSkipException
from airflow.providers.standard.operators.python import PythonOperator
from airflow.sdk import Asset

import requests

DEFAULT_ARGS = {{
    "retries": {retry},
    "retry_delay": timedelta(minutes=5),
}}


def ingest(**_):
    """Data Mates API 에 적재를 시키고 결과를 로그로 남긴다."""
    r = requests.post({url!r}, timeout={timeout})
    body = r.text[:2000]
    if r.status_code >= 400:
        raise RuntimeError("적재 실패 (HTTP %s): %s" % (r.status_code, body))

    result = r.json()
    print("적재 결과:", body)
    if not result.get("rows"):
        # 새로 들어온 행이 없으면 Asset 이벤트를 내지 않는다 —
        # 바뀐 게 없는데 후행 파이프라인을 깨우면 빈 실행만 쌓인다.
        raise AirflowSkipException("새로 들어온 행이 없어 건너뜁니다.")
    return result


with DAG(
    dag_id={dag_id!r},
    description={description!r},
    start_date=datetime(2026, 1, 1),
    schedule={schedule_expr},
    catchup=False,
    max_active_runs=1,
    default_args=DEFAULT_ARGS,
    tags=["datamates", "수집", {job_id!r}],
) as dag:

    PythonOperator(
        task_id={task_id!r},
        python_callable=ingest,
        pool={pool!r},
        outlets=[Asset({asset_uri!r})],
    )
'''

MODE_LABEL = {"append": "덧붙이기", "overwrite": "전체 교체"}


def task_id_of(target: str) -> str:
    return f"ingest__{target}"


def _schedule_expr(job: dict[str, Any]) -> str:
    if (job.get("trigger_type") or "manual") == "manual":
        return repr(None)
    return repr(FREQ_CRON.get(job.get("freq") or "수동 실행"))


def render(job: dict[str, Any]) -> str:
    jid = job["id"]
    return TEMPLATE.format(
        name=job.get("name") or jid,
        target_full=f"raw.{job['target']}",
        mode_label=MODE_LABEL.get(job.get("mode") or "append", job.get("mode") or ""),
        dag_id=dag_id_of(jid),
        description=(job.get("name") or jid),
        schedule_expr=_schedule_expr(job),
        retry=int(job.get("retry") or 0),
        job_id=jid,
        task_id=task_id_of(job["target"]),
        url=f"{CONTAINER_API_BASE}/ingest/jobs/{jid}/execute",
        timeout=REQUEST_TIMEOUT,
        pool=POOL,
        asset_uri=model_asset_uri(job["target"]),
    )


def write(job: dict[str, Any]) -> Path:
    DAGS_DIR.mkdir(parents=True, exist_ok=True)
    path = dag_path_of(job["id"])
    path.write_text(render(job))
    return path


def remove(job_id: str) -> bool:
    path = dag_path_of(job_id)
    if path.exists():
        path.unlink()
        return True
    return False
