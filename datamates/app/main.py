"""DATA MATES — dbt 를 실행 엔진으로 쓰는 데이터 플랫폼의 백엔드.

원칙 하나: dbt 프로젝트 파일이 단일 진실 원천이다.
모델의 SQL·컬럼·설명·의존관계는 models/ 아래 파일에만 있고, API 는 그 파일을
쓰고 manifest.json 을 읽어 화면 모양으로 바꿔 줄 뿐이다. 메타스토어(SQLite)에는
dbt 가 모르는 것 — 파이프라인·폴더·설정 — 만 둔다.

인터페이스는 API 인터페이스 설계서(2026-08-07)를 따른다.
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import dbtproj, errors, manifest, state, store
from .config import AIRFLOW_BASE_URL, DBT_DIR, PROJECT_DIR
from .analytics import proxy as superset_proxy
from .routers import (analytics, bootstrap, catalog, history, ingest, lineage,
                      mart, models, models_extra, pipelines, pipelines_extra,
                      quality)

API_PREFIX = "/api/v1"

app = FastAPI(
    title="Data Mates API",
    version="1.0.0",
    description=("데이터 모델 · 파이프라인 · 품질 API. "
                 "실행 엔진은 dbt, 오케스트레이션은 Airflow."),
    openapi_url=f"{API_PREFIX}/openapi.json",
    docs_url="/docs",
)

# 로컬 개발용. 화면을 같은 서버가 내보내므로 실제로는 필요 없지만,
# UI 만 따로 열어 붙일 때를 위해 열어 둔다. 배포 시에는 출처를 좁힌다.
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

errors.install(app)


@app.middleware("http")
async def context_headers(request: Request, call_next):
    """설계서 2.2 공통 헤더.

    조직·프로젝트는 아직 단일이라 데이터 범위를 좁히는 데 쓰이지 않는다.
    그래도 지금부터 받아 두고 응답에 X-Request-Id 를 돌려준다 — 나중에
    멀티 테넌트로 갈 때 화면을 고치지 않아도 되게 하기 위해서다.
    """
    request.state.org = request.headers.get("X-Org-Id")
    request.state.project = request.headers.get("X-Project-Id")
    request.state.env = request.headers.get("X-Env")
    response = await call_next(request)
    rid = request.headers.get("X-Request-Id")
    if rid:
        response.headers["X-Request-Id"] = rid
    return response


@app.on_event("startup")
def _startup() -> None:
    store.init()
    _seed_marts()
    _ensure_iceberg_pool()
    _regenerate_dags()
    _sync_analytics_datasets()


def _seed_marts() -> None:
    """DATA MART 개념을 들이기 전에 만들어진 설치를 한 번 맞춰 준다.

    그전에는 카탈로그의 모든 모델이 분석에서 보였다. 규칙만 바꾸고 끝내면
    이미 만든 대시보드의 근거 데이터가 하루아침에 「분석에서 못 쓰는 모델」이
    되어 버린다. 그래서 최초 1회, **이미 최종 모델인 것**(하류 모델이 없고
    데이터셋이 만들어져 있던 것)을 마트로 올려 둔다.

    이후로는 자동으로 지정하지 않는다 — 무엇을 분석에 내보낼지는 사람이 정한다.
    """
    if store.pref_get("martSeeded") == "1":
        return
    try:
        entries = manifest.all_entries()
        mapped = set(store.ds_all())
        seeded = []
        for mid, e in entries.items():
            if e["kind"] != "model" or e["downstream"] or mid not in mapped:
                continue
            store.mart_set(mid, True)
            seeded.append(mid)
        store.pref_set("martSeeded", "1")
        if seeded:
            print(f"[datamates] DATA MART 초기 지정 {len(seeded)}건: {', '.join(seeded)}")
    except Exception as e:                       # noqa: BLE001
        print(f"[datamates] DATA MART 초기 지정 실패 (기동은 계속): {e}")


def _sync_analytics_datasets() -> None:
    """카탈로그를 Superset 데이터셋에 반영한다.

    데이터셋을 만드는 경로는 이것뿐이다 — 프록시가 데이터셋 쓰기를 막고 있어서
    사람이 Superset 화면에서 만들 수 없다(설계서 리스크 6). 그래서 기동 때
    한 번 맞춰 두지 않으면 모델을 추가해도 분석 화면에서 쓸 수 없다.

    분석 엔진이 안 떠 있을 수 있으므로 실패해도 서버 기동은 막지 않는다 —
    화면의 「동기화」 버튼(/analytics/datasets:sync)이 같은 일을 한다.
    """
    from .analytics import sync as ds_sync
    try:
        out = ds_sync.sync_all()
        msg = f"[datamates] 분석 데이터셋 동기화: {out['byAction']}"
        if out["errors"]:
            msg += f" · 실패 {len(out['errors'])}건"
        if out["orphans"]:
            msg += f" · 고아 {len(out['orphans'])}건"
        print(msg)
    except Exception as e:                       # noqa: BLE001
        print(f"[datamates] 분석 데이터셋 동기화 실패 (기동은 계속): {e}")


def _regenerate_dags() -> None:
    """저장돼 있는 파이프라인·수집 작업의 DAG 파일을 다시 쓴다.

    DAG 파일은 생성물이라 사람이 고치지 않는다는 전제인데, 생성기가 바뀌면
    이미 저장된 파일은 옛 모양 그대로 남는다(예: 새로 들어온 pool 지정).
    저장을 다시 해야만 고쳐지는 상태를 두지 않도록 기동 때 한 번 맞춘다.
    """
    from . import daggen, dbtproj, graph, ingest, ingestdag
    try:
        pipes = store.pipelines()
        owner = graph.ownership(pipes)
        for p in pipes:
            daggen.write(p, graph.flow_for(p, pipes, owner))
        jobs = store.ingest_jobs()
        for j in jobs:
            if j["kind"] == "api":
                ingestdag.write(j)
        # 수집이 등록한 원천 목록도 같은 이유로 다시 맞춘다. reparse 는 하지 않는다 —
        # 기동을 5초 늦추고, 어차피 첫 저장이나 첫 조회에서 갱신된다.
        dbtproj.write_sources(ingest.source_tables(jobs))
    except Exception as e:                       # noqa: BLE001
        print(f"[datamates] DAG 재생성 실패 (기동은 계속): {e}")


def _ensure_iceberg_pool() -> None:
    """Iceberg 커밋을 한 줄에 세우는 Airflow 풀을 만들어 둔다.

    없으면 이 풀을 지정한 태스크(수집·모델 빌드)가 큐에 들어가지도 못한다.
    Airflow 가 아직 안 떠 있을 수 있으므로 실패해도 서버 기동은 막지 않는다 —
    다음 기동 때 다시 시도한다.
    """
    from . import airflow_client as af
    from .daggen import POOL
    try:
        af.ensure_pool(POOL, 1, "Iceberg 카탈로그(SQLite) 동시 커밋 방지 — 슬롯 1")
    except Exception as e:                       # noqa: BLE001
        print(f"[datamates] Airflow 풀 {POOL} 준비 실패 (기동은 계속): {e}")


# ---------------------------------------------------------------- 상태

@app.get(f"{API_PREFIX}/health", tags=["meta"])
def health() -> dict[str, Any]:
    """스택이 통하는지 한 번에 본다 — manifest 가 읽히는지, Airflow 가 응답하는지."""
    out: dict[str, Any] = {"project_dir": str(PROJECT_DIR), "dbt_dir": str(DBT_DIR),
                           "airflow": AIRFLOW_BASE_URL}
    try:
        out["manifest"] = manifest.meta()
    except Exception as e:  # noqa: BLE001 — 원인을 그대로 보여주는 게 목적이다
        out["manifest"] = {"error": str(e)}
    try:
        from . import airflow_client as af
        af.request("GET", "/version")
        out["airflowOk"] = True
    except Exception as e:  # noqa: BLE001
        out["airflowOk"] = False
        out["airflowError"] = str(e)
    return out


@app.post(f"{API_PREFIX}/reparse", tags=["meta"])
def reparse() -> dict[str, Any]:
    """dbt 프로젝트를 밖에서 손댔을 때 카탈로그를 새로 읽는다."""
    dbtproj.reparse()
    state.invalidate()
    return {"ok": True, "manifest": manifest.meta()}


# ---------------------------------------------------------------- 라우터
#
# 등록 순서가 중요하다. models_extra 의 /models/graph 는 models 의 /models/{id} 보다
# 먼저 등록돼야 "graph" 가 model_id 로 잡히지 않는다.
# 마찬가지로 pipelines_extra 의 고정 경로(/pipelines/{id}/config 등)를 먼저 둔다.
for r in (bootstrap.router,
          mart.router, models_extra.router, models.router,
          pipelines_extra.router, pipelines.router,
          ingest.router, catalog.router, quality.router, history.router,
          lineage.router, analytics.router):
    app.include_router(r, prefix=API_PREFIX)


# 분석 화면의 iframe 이 부르는 리버스 프록시.
#
# 등록 순서가 이 두 줄의 전부다.
#   · api_fallback 은 **플랫폼 라우터 뒤** — /api/v1 이 겹치므로 플랫폼이 먼저 잡는다.
#   · router 는 **UI 마운트 앞** — /static/... 이 정적 파일 핸들러에 먹히면 안 된다.
# 접두사를 붙이지 않는다. Superset 이 만드는 절대 경로를 같은 이름으로 내보내야
# 하기 때문이다 — 이유는 analytics/proxy.py 의 모듈 주석.
app.include_router(superset_proxy.api_fallback)
app.include_router(superset_proxy.router)


# 화면을 같은 서버에서 내보낸다 — 설치형이라 진입점이 하나여야 한다.
# (라우터를 모두 등록한 뒤에 마운트해야 "/" 가 API 경로를 가리지 않는다)
UI_DIR = PROJECT_DIR / "ui"


class _FreshStatic(StaticFiles):
    """UI 파일은 매번 재검증하게 한다.

    기본값으로는 브라우저가 메모리 캐시의 api.js 를 그대로 재사용해서,
    파일을 고쳐도 옛 코드가 계속 돌았다(문서를 새로 고쳐도 <script src> 는
    캐시에서 나온다). 화면이 코드와 다르게 동작하는 원인을 찾는 데 시간이 든다.

    no-cache 는 캐시하지 말라가 아니라 쓰기 전에 물어보라다.
    ETag 가 같으면 304(본문 없음)라 비용은 사실상 없다.
    """

    def file_response(self, *args, **kwargs):
        resp = super().file_response(*args, **kwargs)
        resp.headers["Cache-Control"] = "no-cache"
        return resp


if UI_DIR.is_dir():
    app.mount("/", _FreshStatic(directory=UI_DIR, html=True), name="ui")
