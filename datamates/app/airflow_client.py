"""Airflow REST API v2 클라이언트.

Airflow 3 은 JWT 를 쓴다. /auth/token 으로 받아 두고 401 이 나면 한 번 다시 받는다
(만료 시각을 따로 추적하지 않는 이유: 만료는 401 로 드러나고, 재발급이 싸다).
"""

from __future__ import annotations

import threading
from typing import Any

import httpx

from .config import AIRFLOW_BASE_URL, AIRFLOW_USER, airflow_password

_lock = threading.Lock()
_token: str | None = None

TIMEOUT = httpx.Timeout(30.0, connect=10.0)


class AirflowError(RuntimeError):
    def __init__(self, message: str, status: int = 0, body: str = ""):
        super().__init__(message)
        self.status = status
        self.body = body


def _fetch_token() -> str:
    r = httpx.post(f"{AIRFLOW_BASE_URL}/auth/token", timeout=TIMEOUT,
                   json={"username": AIRFLOW_USER, "password": airflow_password()})
    if r.status_code != 201 and r.status_code != 200:
        raise AirflowError("Airflow 인증에 실패했습니다.", r.status_code, r.text[:500])
    return r.json()["access_token"]


def _token_get(refresh: bool = False) -> str:
    global _token
    with _lock:
        if refresh or _token is None:
            _token = _fetch_token()
        return _token


def request(method: str, path: str, **kw: Any) -> Any:
    """API v2 호출. 401 이면 토큰을 한 번 갱신하고 재시도한다."""
    url = f"{AIRFLOW_BASE_URL}/api/v2{path}"
    # 호출부가 Accept 같은 헤더를 함께 줄 수 있다. 인증 헤더에 얹어야
    # httpx 에 headers 가 두 번 넘어가지 않는다.
    extra = kw.pop("headers", None) or {}
    for attempt in (0, 1):
        headers = {"Authorization": f"Bearer {_token_get(refresh=attempt == 1)}", **extra}
        r = httpx.request(method, url, headers=headers, timeout=TIMEOUT, **kw)
        if r.status_code == 401 and attempt == 0:
            continue
        if r.status_code >= 400:
            raise AirflowError(f"Airflow {method} {path} 실패 ({r.status_code})",
                               r.status_code, r.text[:1000])
        if not r.content:
            return None
        return r.json()
    raise AirflowError("Airflow 호출이 반복 실패했습니다.")


# ---------------------------------------------------------------- DAG

def dag_get(dag_id: str) -> dict[str, Any] | None:
    try:
        return request("GET", f"/dags/{dag_id}")
    except AirflowError as e:
        if e.status == 404:
            return None
        raise


def dag_set_paused(dag_id: str, paused: bool) -> dict[str, Any]:
    """예약 실행을 끄고 켠다.

    일시정지는 예약(schedule)만 멈춘다 — 수동 실행은 그대로 된다.
    이미 돌고 있는 실행도 멈추지 않는다.
    """
    return request("PATCH", f"/dags/{dag_id}", params={"update_mask": "is_paused"},
                   json={"is_paused": paused})


def dag_unpause(dag_id: str) -> None:
    """생성 직후의 DAG 은 기본이 일시정지 상태다. 켜 주지 않으면 트리거해도 돌지 않는다."""
    request("PATCH", f"/dags/{dag_id}", params={"update_mask": "is_paused"},
            json={"is_paused": False})


def dag_delete(dag_id: str) -> None:
    try:
        request("DELETE", f"/dags/{dag_id}")
    except AirflowError as e:
        if e.status != 404:
            raise


def trigger(dag_id: str, conf: dict[str, Any] | None = None,
            note: str | None = None) -> dict[str, Any]:
    body: dict[str, Any] = {"conf": conf or {}, "logical_date": None}
    if note:
        body["note"] = note
    return request("POST", f"/dags/{dag_id}/dagRuns", json=body)


def dag_runs(dag_id: str, limit: int = 20) -> list[dict[str, Any]]:
    out = request("GET", f"/dags/{dag_id}/dagRuns",
                  params={"limit": limit, "order_by": "-run_after"})
    return out.get("dag_runs", []) if out else []


def dag_run(dag_id: str, run_id: str) -> dict[str, Any]:
    return request("GET", f"/dags/{dag_id}/dagRuns/{run_id}")


def task_instances(dag_id: str, run_id: str) -> list[dict[str, Any]]:
    out = request("GET", f"/dags/{dag_id}/dagRuns/{run_id}/taskInstances",
                  params={"limit": 200})
    return out.get("task_instances", []) if out else []


def task_log(dag_id: str, run_id: str, task_id: str, try_number: int = 1) -> str:
    out = request("GET",
                  f"/dags/{dag_id}/dagRuns/{run_id}/taskInstances/{task_id}/logs/{try_number}",
                  headers={"Accept": "application/json"})
    if isinstance(out, dict):
        content = out.get("content")
        if isinstance(content, list):
            # Airflow 3 은 구조화 로그를 리스트로 준다. 화면에는 줄글이 필요하다.
            return "\n".join(
                (c.get("event") or "") if isinstance(c, dict) else str(c) for c in content)
        return str(content or "")
    return str(out or "")


def clear_tasks(dag_id: str, run_id: str, task_ids: list[str]) -> Any:
    """지정한 태스크를 초기화해 다시 돌린다 — 실패한 모델부터 다시 실행.

    Airflow 가 이미 가진 기능이라 부분 재실행 로직을 직접 짤 필요가 없다.

    엔드포인트 선택에 주의. /dagRuns/{run}/taskInstances 의 PATCH 는 Airflow 3 에서
    actions 봉투를 받는 벌크 API 로 바뀌어 여기 쓰기에 맞지 않는다(422).
    clearTaskInstances 가 include_downstream 을 그대로 지원한다.

    기본값을 그대로 두면 안 되는 항목이 둘 있다:
      dry_run     기본 True — 그대로 두면 지울 목록만 돌려주고 아무것도 안 지운다
      only_failed 기본 True — 성공한 모델은 건너뛴다. 우리는 지정 지점부터 전부
                  다시 돌리려는 것이므로 False 로 둔다
    """
    return request("POST", f"/dags/{dag_id}/clearTaskInstances",
                   json={"dry_run": False, "dag_run_id": run_id, "task_ids": task_ids,
                         "only_failed": False, "reset_dag_runs": True,
                         "include_downstream": True, "include_upstream": False})


def ensure_pool(name: str, slots: int, description: str = "") -> None:
    """슬롯 수가 정해진 Airflow 풀을 보장한다.

    웨어하우스 커밋을 DAG 을 가로질러 조이는 장치다. 풀이 없으면 그 풀을 지정한
    태스크는 큐에 들어가지도 못하므로, 있는지 확인하고 없으면 만든다.

    이미 있을 때는 **줄이는 방향만** 반영한다. 운영자가 넓혀 둔 값은 존중하되,
    코드가 「이 이상은 안 된다」고 판단해 낮춘 값은 반드시 내려가야 하기 때문이다.
    실제로 이 비대칭이 필요했다 — 카탈로그를 Postgres 로 옮기며 슬롯을 2로 넓혔다가
    DuckLake 의 낙관적 동시성 때문에 1로 되돌렸는데, 그냥 두면 옛 슬롯 2가 남아
    커밋 충돌이 계속됐다.
    """
    try:
        cur = request("GET", f"/pools/{name}")
        if int(cur.get("slots") or 0) > slots:
            # PATCH 본문은 «전체» 를 요구한다. 부분만 보내면 422 이고, 키 이름도
            # 응답(name)과 달리 요청에서는 pool 이다 — 응답을 그대로 되돌려주면 막힌다.
            request("PATCH", f"/pools/{name}",
                    json={"pool": name, "slots": slots, "description": description,
                          "include_deferred": bool(cur.get("include_deferred", False))})
        return
    except AirflowError as e:
        if e.status != 404:
            raise
    request("POST", "/pools", json={"name": name, "slots": slots,
                                    "description": description})


def asset_event(uri: str) -> bool:
    """Asset 갱신 이벤트를 발행한다 — 데이터 이벤트 트리거의 원천.

    원천 CSV(dbt seed)는 API 서버가 로컬에서 적재하므로 Airflow 태스크의
    outlets 를 타지 않는다. 적재가 성공하면 여기로 직접 이벤트를 낸다.
    아직 아무 DAG 도 이 asset 을 구독하지 않으면 Airflow 에 등록 자체가
    없어 조용히 건너뛴다(False).
    """
    out = request("GET", "/assets", params={"uri_pattern": uri})
    hit = next((a for a in out.get("assets", []) if a.get("uri") == uri), None)
    if not hit:
        return False
    request("POST", "/assets/events", json={"asset_id": hit["id"]})
    return True
