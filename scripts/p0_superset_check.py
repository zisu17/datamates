#!/usr/bin/env python
"""P0 ② — Superset 이 analytics.* 를 데이터셋으로 인식하는가.

p0_duckdb_check.py 가 「DuckDB 가 보여주는가」까지 확인한다. 이 스크립트는 그 위층 —
Superset 이 그 카탈로그를 스키마·테이블 목록으로 잡고 데이터셋을 만들 수 있는가 —
를 REST API 로 확인한다. 화면을 손으로 누르는 대신 API 로 하는 이유는 반복 가능해야
하기 때문이다(설정을 고치고 다시 돌리는 일이 P0 에서 여러 번 생긴다).

전제 — Superset 이 떠 있어야 한다:
    docker-compose -f docker-compose.yml -f docker-compose.superset.yml up -d --build

사용법:
    .venv/bin/python scripts/p0_superset_check.py
    .venv/bin/python scripts/p0_superset_check.py --base http://localhost:8088
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import uuid
from typing import Any

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO)

DB_NAME = "Data Mates 웨어하우스"
# Superset 컨테이너 안에서 도는 DuckDB 다. 파일이 아니라 인메모리이고,
# 실제 데이터는 superset_config.py 의 접속 훅이 ATTACH 하는 Iceberg 카탈로그에 있다.
DB_URI = "duckdb:///:memory:"
SCHEMA = os.environ.get("DBT_SCHEMA", "analytics")
PROBE_TABLE = "fct_apt_trade"

EXPECTED = [
    "stg_apt_trade", "stg_apt_rent", "stg_apt_silv", "dim_region",
    "fct_apt_trade", "fct_apt_rent", "fct_apt_silv",
    "mart_gap_watch", "mart_gap_by_region", "mart_market_monthly",
    "mart_silv_monthly",
]

_results: list[tuple[str, bool, str]] = []


def record(name: str, ok: bool, note: str = "") -> None:
    _results.append((name, ok, note))
    print(f"  [{'PASS' if ok else 'FAIL'}] {name}" + (f" — {note}" if note else ""))


class Superset:
    """Superset REST API 최소 클라이언트.

    POST 는 JWT 만으로 통과하지 않는다 — X-CSRFToken 과 그 토큰을 발급한 세션 쿠키가
    함께 있어야 한다. 그래서 requests.Session 을 계속 들고 다닌다.
    """

    def __init__(self, base: str, user: str, password: str) -> None:
        import requests
        self.base = base.rstrip("/")
        self.s = requests.Session()
        self.token = ""
        self.csrf = ""
        self._user, self._pw = user, password

    def login(self) -> None:
        r = self.s.post(f"{self.base}/api/v1/security/login",
                        json={"username": self._user, "password": self._pw,
                              "provider": "db", "refresh": True}, timeout=30)
        r.raise_for_status()
        self.token = r.json()["access_token"]
        r = self.s.get(f"{self.base}/api/v1/security/csrf_token/",
                       headers={"Authorization": f"Bearer {self.token}"}, timeout=30)
        r.raise_for_status()
        self.csrf = r.json()["result"]

    def _h(self, post: bool = False) -> dict[str, str]:
        h = {"Authorization": f"Bearer {self.token}"}
        if post:
            h["X-CSRFToken"] = self.csrf
            h["Referer"] = self.base
            h["Content-Type"] = "application/json"
        return h

    def get(self, path: str, **kw: Any) -> Any:
        r = self.s.get(f"{self.base}{path}", headers=self._h(), timeout=120, **kw)
        if r.status_code >= 400:
            raise RuntimeError(f"GET {path} → {r.status_code} {r.text[:400]}")
        return r.json()

    def post(self, path: str, body: dict[str, Any]) -> Any:
        r = self.s.post(f"{self.base}{path}", headers=self._h(post=True),
                        json=body, timeout=180)
        if r.status_code >= 400:
            raise RuntimeError(f"POST {path} → {r.status_code} {r.text[:600]}")
        return r.json()


def wait_health(base: str, timeout: float = 180.0) -> bool:
    import requests
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            if requests.get(f"{base}/health", timeout=5).status_code == 200:
                return True
        except Exception:      # noqa: BLE001, S110
            pass
        time.sleep(3)
    return False


def ensure_database(sup: Superset) -> int:
    """DuckDB 연결을 만든다. 이미 있으면 그것을 쓴다(스크립트를 반복 실행하므로)."""
    q = json.dumps({"filters": [{"col": "database_name", "opr": "eq", "value": DB_NAME}]})
    existing = sup.get(f"/api/v1/database/?q={q}")
    if existing.get("count"):
        return existing["result"][0]["id"]

    out = sup.post("/api/v1/database/", {
        "database_name": DB_NAME,
        "sqlalchemy_uri": DB_URI,
        "expose_in_sqllab": True,
        "allow_ctas": False,
        "allow_cvas": False,
        "allow_dml": False,          # 조회 전용 — 쓰기는 dbt 와 Spark 의 일이다
        "cache_timeout": 60,
    })
    return out["id"]


def main() -> int:
    ap = argparse.ArgumentParser(description="P0 ② — Superset 데이터셋 인식 확인")
    ap.add_argument("--base", default=os.environ.get("SUPERSET_BASE", "http://localhost:8088"))
    ap.add_argument("--user", default=os.environ.get("SUPERSET_ADMIN_USER", "admin"))
    ap.add_argument("--password", default=os.environ.get("SUPERSET_ADMIN_PASSWORD", "admin"))
    args = ap.parse_args()

    print("=" * 68)
    print("P0 ② — Superset 이 analytics.* 를 데이터셋으로 인식하는가")
    print(f"  Superset : {args.base}")
    print("=" * 68)

    try:
        import requests      # noqa: F401
    except ImportError:
        print("requests 가 없습니다 — .venv/bin/pip install requests")
        return 3

    print("\n기동 대기")
    if not wait_health(args.base):
        record("Superset /health 응답", False, "180초 안에 뜨지 않았다")
        print("\n  docker-compose -f docker-compose.yml -f docker-compose.superset.yml logs superset")
        return 1
    record("Superset /health 응답", True, "")

    sup = Superset(args.base, args.user, args.password)
    try:
        sup.login()
    except Exception as e:      # noqa: BLE001
        record("관리자 로그인", False, f"{type(e).__name__}: {str(e)[:200]}")
        return 1
    record("관리자 로그인", True, "")

    # ── 연결 ──────────────────────────────────────────────
    print("\nDuckDB 연결 등록")
    try:
        db_id = ensure_database(sup)
    except Exception as e:      # noqa: BLE001
        record("연결 등록", False, f"{type(e).__name__}: {str(e)[:300]}")
        return 1
    record("연결 등록", True, f"database_id={db_id}")

    # 접속 훅이 실제로 걸렸는지가 여기서 드러난다. 훅이 안 걸리면 스키마 목록에
    # main 만 나오고 analytics 가 없다.
    print("\n스키마 · 테이블 인식")
    try:
        schemas = sup.get(f"/api/v1/database/{db_id}/schemas/?q=(force:!t)")["result"]
    except Exception as e:      # noqa: BLE001
        record("스키마 목록", False, f"{type(e).__name__}: {str(e)[:300]}")
        return 1
    # Superset 의 DuckDB 스펙은 스키마를 «카탈로그.스키마» 로 돌려준다.
    # 데이터셋을 만들 때도 이 전체 문자열을 써야 한다. P3 의 동기화 코드도 같다.
    #
    # memory.<schema> 를 먼저 고른다 — 접속 훅이 만든 미러 뷰가 있는 쪽이다.
    # ice.<schema> 는 Iceberg 직결이고, 그쪽은 컬럼 메타데이터가 비어 있어
    # 데이터셋을 만들어도 «__ / UNKNOWN» 껍데기가 된다 (P0 에서 확인한 DuckDB 한계).
    hit = ([s for s in schemas if s == f"memory.{SCHEMA}"]
           or [s for s in schemas if s == SCHEMA or s.endswith(f".{SCHEMA}")])
    record(f"스키마 목록에 {SCHEMA} 있음", bool(hit), f"{schemas}")

    if not hit:
        print("\n  ↳ 접속 훅이 걸리지 않았을 가능성이 높다. 컨테이너 로그에서 확인:")
        print("     docker-compose -f docker-compose.superset.yml logs superset "
              "| grep -i 'DuckDB 초기화'")
        return 1

    sup_schema = hit[0]
    if sup_schema != SCHEMA:
        print(f"       ↳ Superset 이 쓰는 스키마 문자열은 {sup_schema!r} 다 "
              f"({SCHEMA!r} 가 아니다).")

    try:
        q = f"(force:!t,schema_name:{sup_schema})"
        tables = [t["value"] for t in
                  sup.get(f"/api/v1/database/{db_id}/tables/?q={q}")["result"]]
    except Exception as e:      # noqa: BLE001
        record("테이블 목록", False, f"{type(e).__name__}: {str(e)[:300]}")
        return 1
    missing = [m for m in EXPECTED if m not in tables]
    record("dbt 모델 전부 테이블 목록에 있음", not missing,
           f"{len(tables)}개 조회 / 누락 {missing}" if missing else f"{len(tables)}개 조회")

    # ── 데이터셋 ──────────────────────────────────────────
    print("\n데이터셋 생성")
    ds_id = None
    try:
        q = json.dumps({"filters": [
            {"col": "table_name", "opr": "eq", "value": PROBE_TABLE}]})
        found = sup.get(f"/api/v1/dataset/?q={q}")
        if found.get("count"):
            ds_id = found["result"][0]["id"]
            record("데이터셋", True, f"이미 있음 dataset_id={ds_id}")
        else:
            out = sup.post("/api/v1/dataset/", {
                "database": db_id, "schema": sup_schema, "table_name": PROBE_TABLE})
            ds_id = out["id"]
            record("데이터셋 생성", True, f"dataset_id={ds_id}")
    except Exception as e:      # noqa: BLE001
        record("데이터셋 생성", False, f"{type(e).__name__}: {str(e)[:400]}")

    if ds_id:
        try:
            ds = sup.get(f"/api/v1/dataset/{ds_id}")["result"]
            cols = [(c["column_name"], c.get("type")) for c in ds.get("columns", [])]
            record("컬럼 타입 인식", len(cols) > 0,
                   ", ".join(f"{n}:{t}" for n, t in cols) or "컬럼이 잡히지 않았다")
            # 시간 컬럼이 하나라도 있어야 시계열 차트를 만들 수 있다.
            temporal = [n for n, t in cols
                        if t and ("TIMESTAMP" in str(t).upper() or "DATE" in str(t).upper())]
            record("시간 컬럼 인식 (시계열 차트 전제)", bool(temporal), f"{temporal}")
        except Exception as e:      # noqa: BLE001
            record("데이터셋 컬럼 조회", False, f"{type(e).__name__}: {str(e)[:300]}")

    # ── 실제 질의 + 플랫폼과 대조 ──────────────────────────
    print("\nSQL Lab 질의 · 플랫폼 결과와 대조")
    sql = f"select count(*) as n from {sup_schema}.{PROBE_TABLE}"
    try:
        out = sup.post("/api/v1/sqllab/execute/", {
            "database_id": db_id, "schema": sup_schema, "sql": sql,
            "runAsync": False, "select_as_cta": False, "json": True,
            # client_id 는 query 테이블에서 유일해야 하고 varchar(11) 이다.
            # 고정값이면 두 번째 실행이 UniqueViolation, 12자 이상이면 길이 초과로 500.
            "client_id": uuid.uuid4().hex[:11], "tab": "p0", "tmp_table_name": "",
            "ctas_method": "TABLE", "queryLimit": 100,
        })
        sup_n = out["data"][0]["n"]
        record("SQL Lab 질의 성공", True, f"count = {sup_n}")
    except Exception as e:      # noqa: BLE001
        record("SQL Lab 질의", False, f"{type(e).__name__}: {str(e)[:400]}")
        sup_n = None

    if sup_n is not None:
        try:
            from datamates.app import warehouse
            plat_n = warehouse.query(
                f"select count(*) as n from ice.{SCHEMA}.{PROBE_TABLE}")["rows"][0][0]
            record("플랫폼 결과와 일치", plat_n == sup_n,
                   f"플랫폼 {plat_n} / Superset {sup_n}")
        except Exception as e:      # noqa: BLE001
            record("플랫폼 결과와 대조", False, f"{type(e).__name__}: {str(e)[:200]}")

    print("\n" + "=" * 68)
    failed = [r for r in _results if not r[1]]
    print(f"결과 — {len(_results) - len(failed)} PASS / {len(failed)} FAIL")
    for name, _, note in failed:
        print(f"  FAIL  {name} — {note}")
    if not failed:
        print("\nP0 ② 통과. 만들어진 연결·데이터셋은 P1 이후에도 쓰므로 지우지 않는다.")
    print("=" * 68)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
