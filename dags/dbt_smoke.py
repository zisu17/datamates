"""
배관 확인용 스모크 DAG.

목적은 파이프라인이 아니라 **환경이 통하는지**만 보는 것이다:
  - 컨테이너 안의 dbt 가 실행되는가
  - iceberg-rest / minio 에 서비스 이름으로 닿는가
  - Spark 4.0 세션이 뜨는가

실제 파이프라인 DAG 은 이 파일을 참고해서 따로 만들면 된다.
"""

from datetime import datetime

from airflow import DAG
from airflow.providers.standard.operators.bash import BashOperator

# 컨테이너 안 경로. 호스트의 .venv 와는 무관하다.
DBT = "/opt/dbt-venv/bin/dbt"
PROJECT_DIR = "/opt/project"

with DAG(
    dag_id="dbt_smoke",
    description="dbt/Spark/Iceberg 배관 확인용",
    start_date=datetime(2026, 1, 1),
    schedule=None,          # 수동 실행 전용
    catchup=False,
    tags=["smoke"],
) as dag:

    # 프로필 파싱 + 웨어하우스 연결까지 확인한다.
    dbt_debug = BashOperator(
        task_id="dbt_debug",
        bash_command=f"cd {PROJECT_DIR} && {DBT} debug",
    )

    # 모델을 만들지 않고 컴파일만 — 프로젝트 파싱이 되는지 본다.
    dbt_compile = BashOperator(
        task_id="dbt_compile",
        bash_command=f"cd {PROJECT_DIR} && {DBT} compile",
    )

    dbt_debug >> dbt_compile
