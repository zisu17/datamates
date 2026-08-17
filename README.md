<div align="center">

# 🤝 Data Mates

**흩어진 데이터 작업을 하나의 흐름으로 연결하는 구축형 데이터 플랫폼**

데이터가 들어오는 순간부터 분석에 쓰이는 순간까지, 하나의 환경에서 탐색하고 운영합니다.

![Python](https://img.shields.io/badge/Python-3.11-3776AB?style=flat-square&logo=python&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=flat-square&logo=fastapi&logoColor=white)
![DuckDB](https://img.shields.io/badge/DuckDB-FFF000?style=flat-square&logo=duckdb&logoColor=111)
![dbt](https://img.shields.io/badge/dbt-FF694B?style=flat-square&logo=dbt&logoColor=white)
![Apache Airflow](https://img.shields.io/badge/Apache_Airflow-017CEE?style=flat-square&logo=apacheairflow&logoColor=white)
![DuckLake](https://img.shields.io/badge/DuckLake-4E8DC4?style=flat-square&logo=duckdb&logoColor=white)

</div>

![수집부터 분석까지 이어지는 Data Mates 사용자 흐름](docs/images/datamates-demo2.gif)

## ✨ Overview

데이터를 운영하려면 수집 설정, 모델 SQL, 계보, 파이프라인 상태, 품질 결과와 대시보드를 서로 다른 도구에서 확인해야 합니다. 하나의 문제를 추적하는 데에도 여러 화면과 파일을 오가며 맥락을 다시 맞춰야 합니다.

Data Mates는 기존 dbt 프로젝트와 실행 환경을 그대로 연결해 **수집 → 모델링 → 실행 → 품질 → 분석**을 하나의 흐름으로 보여줍니다. 데이터의 출처와 변환 과정, 실패 지점, 변경 영향 범위와 실제 활용 현황을 한곳에서 탐색하고 운영하는 것이 목표입니다.

## 🧩 Key Features

<table>
  <tr>
    <td width="50%" valign="top">
      <h3>01 · 📥 Collect</h3>
      HTTP API와 CSV·JSON Lines 데이터를 미리 확인한 뒤 원천 데이터로 등록합니다. 수동 실행과 예약 실행을 지원합니다.
    </td>
    <td width="50%" valign="top">
      <h3>02 · 🧱 Model</h3>
      기존 dbt 프로젝트의 SQL, 설명, 컬럼과 테스트를 기반으로 데이터 모델을 탐색하고 편집합니다.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>03 · 🕸️ Lineage</h3>
      모델과 컬럼의 상·하류 경로를 추적해 데이터가 만들어지는 과정과 변경 영향 범위를 확인합니다.
    </td>
    <td width="50%" valign="top">
      <h3>04 · ⚙️ Pipeline</h3>
      모델 의존성에 맞춰 실행 순서를 구성하고, 수동·예약·이벤트 실행과 실패 지점부터의 재실행을 관리합니다.
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <h3>05 · ✅ Quality</h3>
      필수값, 중복, 허용값, 참조 무결성과 범위 규칙을 검사하고 실제 위반 데이터까지 확인합니다.
    </td>
    <td width="50%" valign="top">
      <h3>06 · 📊 Analytics</h3>
      분석용 데이터 마트, 데이터셋과 대시보드를 탐색하고 원천 데이터부터 분석 자산까지의 연결을 확인합니다.
    </td>
  </tr>
</table>

## 🏗️ Architecture

![Data Mates 아키텍처](docs/images/architecture.svg)

## 🛠️ Tech Stack

| Area | Technologies |
| --- | --- |
| Application | ![Python](https://img.shields.io/badge/Python_3.11-3776AB?style=flat-square&logo=python&logoColor=white) ![FastAPI](https://img.shields.io/badge/FastAPI-009688?style=flat-square&logo=fastapi&logoColor=white) ![JavaScript](https://img.shields.io/badge/Vanilla_JS-F7DF1E?style=flat-square&logo=javascript&logoColor=111) |
| Modeling & Compute | ![dbt](https://img.shields.io/badge/dbt_Core-FF694B?style=flat-square&logo=dbt&logoColor=white) ![DuckDB](https://img.shields.io/badge/dbt--duckdb-FFF000?style=flat-square&logo=duckdb&logoColor=111) |
| Orchestration | ![Apache Airflow](https://img.shields.io/badge/Apache_Airflow-017CEE?style=flat-square&logo=apacheairflow&logoColor=white) |
| Lakehouse | ![DuckLake](https://img.shields.io/badge/DuckLake-4E8DC4?style=flat-square&logo=duckdb&logoColor=white) ![MinIO](https://img.shields.io/badge/MinIO-C72E49?style=flat-square&logo=minio&logoColor=white) ![DuckDB](https://img.shields.io/badge/DuckDB-FFF000?style=flat-square&logo=duckdb&logoColor=111) |
| Analytics | ![Apache Superset](https://img.shields.io/badge/Apache_Superset-20A6C9?style=flat-square&logo=apachesuperset&logoColor=white) |
| Infrastructure | ![Docker](https://img.shields.io/badge/Docker_Compose-2496ED?style=flat-square&logo=docker&logoColor=white) ![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=flat-square&logo=postgresql&logoColor=white) ![Redis](https://img.shields.io/badge/Redis-FF4438?style=flat-square&logo=redis&logoColor=white) |

## 🚀 Getting Started

### Prerequisites

- Python 3.11
- Docker 환경
- 연결할 dbt 프로젝트

### Run

```bash
# 1. 사용할 dbt 프로젝트 연결
export DBT_PROJECT_DIR=/absolute/path/to/your-dbt-project

# 2. 카탈로그 볼륨 준비
docker volume create iceberg-catalog

# 3. 분석 환경을 포함한 전체 스택 실행
docker-compose -f docker-compose.yml -f docker-compose.superset.yml up -d

# 4. Iceberg 카탈로그 초기화
./scripts/bootstrap_catalog.sh
```

### 🐳 Container Image

[![Docker Image Version](https://img.shields.io/docker/v/zisu17/datamates?style=flat-square&logo=docker&logoColor=white&label=zisu17%2Fdatamates&color=2496ED)](https://hub.docker.com/r/zisu17/datamates)

Data Mates는 애플리케이션, Airflow, Superset을 하나의 이미지로 배포합니다. 각 컨테이너는 같은 이미지를 서로 다른 명령으로 실행하며, Docker Compose가 이미지를 자동으로 내려받습니다.

| 계층 | 구성 |
| --- | --- |
| Application | FastAPI · 웹 UI · DuckDB · psycopg · sqlglot |
| Orchestration | Apache Airflow 3.2.2 |
| Transformation | dbt Core 1.12.0 · dbt-duckdb 1.11.0 · DuckDB 1.5.5 · Elementary |
| Analytics | Apache Superset 5.0.0 · duckdb-engine |

MinIO, PostgreSQL, Redis는 공식 이미지를 사용하고, Iceberg REST 카탈로그만 PostgreSQL JDBC 드라이버를 더해 로컬에서 빌드합니다(`docker/iceberg-rest`). 현재 Data Mates 이미지는 **linux/arm64**만 지원하며, 직접 빌드하는 방법은 [SETUP.md](docs/SETUP.md)를 참고하세요.

## 🎯 Current Scope

Data Mates는 현재 **단일 사용자·소규모 구축형 환경**을 기준으로 개발하고 있습니다.

- 인증, 역할 기반 권한 관리와 조직·사용자별 데이터 격리는 현재 지원하지 않습니다.
- 수집 단계에서는 원본 보존을 위해 값을 문자열로 저장하고, 타입 변환은 모델링 단계에서 수행합니다.
- 메타데이터 저장소와 실행 환경은 개인 또는 소규모 데이터 팀의 로컬 구축을 기준으로 구성합니다.
- 다중 사용자 협업과 대규모 분산 운영은 향후 확장 범위입니다.
