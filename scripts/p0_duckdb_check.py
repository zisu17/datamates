#!/usr/bin/env python
"""P0 — Superset 이 쓸 질의 경로를 Superset 없이 먼저 검증한다.

설계서(4장) 의 P0 다섯 항목 중 Superset 을 띄우지 않고 확인할 수 있는 것을 여기서 본다.
질의 경로의 위험은 전부 이 층에 있다 — Superset 은 그 위에 얹히는 껍데기다.

  ① 접속마다 Iceberg REST 카탈로그가 자동 ATTACH 되는가      → check_attach
  ② analytics.* 테이블이 목록에 잡히는가                      → check_tables
  ③ 동시 5~10 질의가 견디는가                                 → check_concurrency
  ④ 적재 직후 최신 스냅샷이 보이는가                          → --watch (별도 모드)
  ⑤ timestamp · decimal · null · nested 가 플랫폼과 일치하는가 → check_types

②는 여기서 "DuckDB 가 보여주는가"까지만 본다. "Superset 데이터셋으로 인식되는가"는
scripts/p0_superset_check.py 가 REST API 로 확인한다.

사용법
    .venv/bin/python scripts/p0_duckdb_check.py
    .venv/bin/python scripts/p0_duckdb_check.py --watch analytics.fct_apt_trade
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import os
import sys
import time
import urllib.request
from typing import Any

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO)

REST_URI = os.environ.get("ICEBERG_REST_URI", "http://localhost:8181")
MINIO_ENDPOINT = os.environ.get("MINIO_ENDPOINT", "http://localhost:9000")
MINIO_USER = os.environ.get("MINIO_ROOT_USER", "minioadmin")
MINIO_PASSWORD = os.environ.get("MINIO_ROOT_PASSWORD", "minioadmin")
ALIAS = "ice"
SCHEMA = os.environ.get("DBT_SCHEMA", "analytics")

# 이 목록과 실제 카탈로그를 대조한다. dbt/models 의 .sql 파일명이 곧 모델 이름이다.
EXPECTED = [
    "stg_apt_trade", "stg_apt_rent", "stg_apt_silv", "dim_region",
    "fct_apt_trade", "fct_apt_rent", "fct_apt_silv",
    "mart_gap_watch", "mart_gap_by_region", "mart_market_monthly",
    "mart_silv_monthly",
]

_results: list[tuple[str, bool, str]] = []


def record(name: str, ok: bool, note: str = "") -> None:
    _results.append((name, ok, note))
    mark = "PASS" if ok else "FAIL"
    print(f"  [{mark}] {name}" + (f" — {note}" if note else ""))


# ─────────────────────────────────────────────────────────────
# 초기화 훅 — docker/superset/superset_config.py 와 같은 내용이어야 한다.
# 두 곳이 갈라지면 여기서 통과한 것이 컨테이너에서 실패한다.
# ─────────────────────────────────────────────────────────────

def _split_endpoint(url: str) -> tuple[str, bool]:
    ssl = url.startswith("https://")
    return url.split("://", 1)[-1].rstrip("/"), ssl


def init_sql() -> list[str]:
    host, ssl = _split_endpoint(MINIO_ENDPOINT)
    return [
        "INSTALL iceberg",
        "LOAD iceberg",
        (f"CREATE OR REPLACE SECRET datamates_s3 (TYPE s3, KEY_ID '{MINIO_USER}', "
         f"SECRET '{MINIO_PASSWORD}', ENDPOINT '{host}', "
         f"USE_SSL {'true' if ssl else 'false'}, URL_STYLE 'path', REGION 'us-east-1')"),
        (f"ATTACH IF NOT EXISTS 'warehouse' AS {ALIAS} (TYPE iceberg, "
         f"ENDPOINT '{REST_URI}', AUTHORIZATION_TYPE 'none')"),
        f"SET GLOBAL TimeZone = "
        f"'{os.environ.get('DATAMATES_DUCKDB_TIMEZONE', 'Asia/Seoul')}'",
    ]


def resolve_columns(cur: Any) -> int:
    """테이블을 한 번 건드려 컬럼 메타데이터를 해석시킨다.

    ATTACH 직후에는 Iceberg 테이블의 컬럼이 information_schema 에 '__ / UNKNOWN'
    하나로만 들어 있다. Superset 은 SQLAlchemy reflection(= information_schema)으로
    데이터셋 컬럼을 잡으므로 이 상태에서 만들면 껍데기가 된다.
    DESCRIBE 를 한 번 돌리면 DuckDB 가 스키마를 해석해 카탈로그를 채운다.

    docker/superset/superset_config.py 의 _resolve_columns 와 같은 동작이어야 한다.
    """
    cur.execute("select table_name from information_schema.tables "
                f"where table_catalog = '{ALIAS}' and table_schema = '{SCHEMA}'")
    names = [r[0] for r in cur.fetchall()]
    for n in names:
        cur.execute(f'DESCRIBE {ALIAS}.{SCHEMA}."{n}"')
        cur.fetchall()
    cur.execute(f"USE {ALIAS}.{SCHEMA}")
    return len(names)


_hook_saw: list[str] = []      # 훅이 실제로 걸린 드라이버 기록 — 가드 검증용
_hook_ran = {"n": 0, "views": 0}


def register_hook() -> None:
    from sqlalchemy import event
    from sqlalchemy.engine import Engine

    @event.listens_for(Engine, "connect")
    def _on_connect(dbapi_conn, connection_record):  # noqa: ANN001, ARG001
        mod = type(dbapi_conn).__module__.split(".")[0]
        _hook_saw.append(f"{mod}.{type(dbapi_conn).__name__}")
        if mod != "duckdb_engine":
            return
        cur = dbapi_conn.cursor()
        for stmt in init_sql():
            cur.execute(stmt)
        _hook_ran["views"] = resolve_columns(cur)
        _hook_ran["n"] += 1


def new_engine() -> Any:
    from sqlalchemy import create_engine
    return create_engine("duckdb:///:memory:")


# ─────────────────────────────────────────────────────────────
# ① 접속마다 ATTACH
# ─────────────────────────────────────────────────────────────

def check_attach(rounds: int = 5) -> None:
    from sqlalchemy import text
    print("\n① 접속마다 Iceberg REST 카탈로그 ATTACH")

    counts = []
    for i in range(rounds):
        eng = new_engine()                       # 매번 새 엔진 = 새 커넥션
        try:
            with eng.connect() as cx:
                n = cx.execute(text(
                    "select count(*) from information_schema.tables "
                    f"where table_catalog = '{ALIAS}'")).scalar()
                counts.append(n or 0)
        finally:
            eng.dispose()

    ok = all(c > 0 for c in counts)
    record("새 커넥션 5회 전부 카탈로그 보임", ok,
           f"테이블 수 {counts}" if ok else f"보이지 않은 회차 있음 {counts}")

    # 가드 — 다른 드라이버에는 걸리지 않아야 한다. 걸리면 메타DB 접속이 깨진다.
    from sqlalchemy import create_engine
    before = _hook_ran["n"]
    eng = create_engine("sqlite:///:memory:")
    try:
        with eng.connect() as cx:
            cx.execute(text("select 1"))
    finally:
        eng.dispose()
    record("가드 — 다른 드라이버(sqlite)에는 ATTACH 하지 않음",
           _hook_ran["n"] == before,
           f"훅이 본 드라이버: {sorted(set(_hook_saw))}")


# ─────────────────────────────────────────────────────────────
# ② 테이블 인식
# ─────────────────────────────────────────────────────────────

def check_tables() -> None:
    from sqlalchemy import text
    print(f"\n② {SCHEMA} 스키마 테이블 인식")

    eng = new_engine()
    try:
        with eng.connect() as cx:
            cur = cx.execute(text("select current_catalog(), current_schema()")).fetchone()
            record(f"기본 카탈로그·스키마가 {ALIAS}.{SCHEMA}",
                   tuple(cur) == (ALIAS, SCHEMA), f"실제 {tuple(cur)}")

            names = [r[0] for r in cx.execute(text("show tables")).fetchall()]
            missing = [m for m in EXPECTED if m not in names]
            record("dbt 모델 전부 목록에 있음", not missing,
                   f"{len(names)}개 조회 / 누락 {missing}" if missing
                   else f"{len(names)}개 조회")

            # Superset 이 스키마 목록을 만들 때 쓰는 경로도 같이 본다.
            schemas = [r[0] for r in cx.execute(text(
                "select catalog_name || '.' || schema_name from information_schema.schemata "
                f"where catalog_name = '{ALIAS}' order by 1")).fetchall()]
            record("스키마 목록 조회 가능", f"{ALIAS}.{SCHEMA}" in schemas, f"{schemas}")

        # Superset 이 데이터셋 컬럼을 잡는 실제 경로 — SQLAlchemy reflection.
        # DESCRIBE 를 돌리지 않았다면 '__' 하나만 나온다.
        # inspect() 는 엔진에서 자기 커넥션을 새로 얻으므로 위 with 블록 밖에서 부른다
        # (안에서 부르면 DuckDB 가 «transaction within a transaction» 으로 막는다).
        from sqlalchemy import inspect as _inspect
        cols = _inspect(eng).get_columns("fct_apt_trade", schema=SCHEMA)
        record("SQLAlchemy reflection 이 컬럼을 잡음 (데이터셋 전제)",
               len(cols) > 1 and all(c["name"] != "__" for c in cols),
               f"{len(cols)}컬럼 — " + ", ".join(
                   f"{c['name']}:{c['type']}" for c in cols[:4]) + " ...")
    finally:
        eng.dispose()


# ─────────────────────────────────────────────────────────────
# ③ 동시 질의
# ─────────────────────────────────────────────────────────────

def check_concurrency(n: int = 10) -> None:
    from sqlalchemy import text
    print(f"\n③ 동시 {n} 질의")

    # Superset 은 엔진 하나를 풀로 재사용한다. 같은 조건으로 본다.
    eng = new_engine()
    hook_before = _hook_ran["n"]

    def one(i: int) -> tuple[int, float, str]:
        t0 = time.perf_counter()
        try:
            with eng.connect() as cx:
                cx.execute(text(
                    f"select count(*) from {ALIAS}.{SCHEMA}.fct_apt_trade")).scalar()
            return i, time.perf_counter() - t0, ""
        except Exception as e:      # noqa: BLE001
            return i, time.perf_counter() - t0, str(e)[:120]

    t0 = time.perf_counter()
    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=n) as ex:
            out = list(ex.map(one, range(n)))
    finally:
        eng.dispose()
    wall = time.perf_counter() - t0

    errs = [o for o in out if o[2]]
    times = sorted(o[1] for o in out)
    fresh_conns = _hook_ran["n"] - hook_before
    record(f"{n}건 전부 성공", not errs,
           f"오류 {len(errs)}건" + (f" 예: {errs[0][2]}" if errs else ""))
    record("cold — 새 커넥션 응답 (중간값 / 최대)", True,
           f"{times[len(times)//2]*1000:.0f}ms / {times[-1]*1000:.0f}ms · 전체 {wall*1000:.0f}ms")
    record("새로 만들어진 커넥션 수", True,
           f"{fresh_conns}개 — 이 수만큼 ATTACH + DESCRIBE {_hook_ran['views']}개가 다시 돈다")

    # warm 비교 — 커넥션 하나를 붙잡고 같은 질의를 반복한다.
    # 플랫폼(warehouse.py)은 프로세스당 커넥션 하나를 계속 재사용하므로 이쪽이 그 조건이다.
    # cold 와 warm 의 차이가 곧 «접속마다 ATTACH» 의 값이다.
    eng2 = new_engine()
    try:
        with eng2.connect() as cx:
            cx.execute(text(f"select count(*) from {ALIAS}.{SCHEMA}.fct_apt_trade"))  # 예열
            warm = []
            for _ in range(n):
                t = time.perf_counter()
                cx.execute(text(f"select count(*) from {ALIAS}.{SCHEMA}.fct_apt_trade")).scalar()
                warm.append(time.perf_counter() - t)
    finally:
        eng2.dispose()
    warm.sort()
    cold_med = times[len(times) // 2]
    warm_med = warm[len(warm) // 2]
    record("warm — 재사용 커넥션 응답 (중간값)", True, f"{warm_med * 1000:.1f}ms")
    record("ATTACH 1회 비용 (cold − warm)", True,
           f"약 {(cold_med - warm_med) * 1000:.0f}ms — 커넥션 풀을 재사용하지 않으면 "
           f"질의마다 이만큼 붙는다")


# ─────────────────────────────────────────────────────────────
# ⑤ 타입 정합 — 플랫폼 경로 vs Superset 경로
# ─────────────────────────────────────────────────────────────

PROBE_SQL = """
select
  cast('2026-08-11 13:45:06.123456' as timestamp)      as ts,
  cast('2026-08-11 13:45:06.123456+09' as timestamptz) as tstz,
  cast(12345.6789 as decimal(18,4))                    as dec,
  cast(null as varchar)                                as nul,
  [1, 2, 3]                                            as arr,
  {'a': 1, 'b': cast('x' as varchar)}                  as strct,
  map(['k'], [cast(1.5 as double)])                    as mp
"""


def _platform_rows(sql: str) -> Any:
    """플랫폼이 실제로 쓰는 경로(datamates/app/warehouse.py)로 조회한다."""
    from datamates.app import warehouse
    return warehouse.query(sql)


def _norm(v: Any) -> Any:
    """warehouse.py 의 _json_safe 와 같은 정규화.

    플랫폼은 HTTP 로 내보내기 위해 Decimal·datetime 을 문자열·float 로 바꾼다.
    그건 직렬화 규칙이고 값의 차이가 아니다. 두 경로를 같은 규칙으로 맞춘 뒤
    비교해야 «값이 어긋나는가» 를 본다.
    """
    import datetime
    import decimal
    if isinstance(v, decimal.Decimal):
        return float(v)
    if isinstance(v, (datetime.date, datetime.datetime, datetime.time)):
        return v.isoformat()
    if isinstance(v, (bytes, bytearray)):
        return v.hex()
    if isinstance(v, dict):
        return {k: _norm(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [_norm(x) for x in v]
    return v


def check_session_settings() -> None:
    """세션 설정 비교 — 값이 같아도 표기가 갈리는 원인.

    설계서 리스크 2 의 실체다. 같은 DuckDB 라이브러리를 써도 TimeZone 이 다르면
    timestamptz 컬럼의 차트 축이 두 화면에서 다른 시각을 가리킨다.
    """
    from sqlalchemy import text
    print("\n⑤-0 세션 설정 비교 (TimeZone · Calendar)")

    keys = ["TimeZone", "Calendar"]
    sql = "select " + ", ".join(f"current_setting('{k}') as {k.lower()}" for k in keys)
    try:
        plat = tuple(_platform_rows(sql)["rows"][0])
        eng = new_engine()
        with eng.connect() as cx:
            sup = tuple(cx.execute(text(sql)).fetchone())
        eng.dispose()
    except Exception as e:      # noqa: BLE001
        record("세션 설정 조회", False, f"{type(e).__name__}: {str(e)[:120]}")
        return

    same = plat == sup
    record("플랫폼 · Superset 세션 설정 일치", same,
           f"{dict(zip(keys, plat))} vs {dict(zip(keys, sup))}")

    want = os.environ.get("DATAMATES_DUCKDB_TIMEZONE", "Asia/Seoul")
    record("TimeZone 이 호스트 로컬이 아니라 명시값으로 고정됨", plat[0] == want,
           f"기대 {want!r} · 실제 {plat[0]!r}")
    if plat[0] != want:
        print("       ↳ SET 이 무력한지 확인할 것. 플랫폼은 모든 조회가 cursor() 를 거치고,")
        print("         cursor() 는 별도 커넥션이라 «SET TimeZone» 은 전파되지 않는다.")
        print("         warehouse.py 는 그래서 «SET GLOBAL TimeZone» 을 쓴다.")


def check_types() -> None:
    from sqlalchemy import text
    print("\n⑤ 타입 정합 — 플랫폼(warehouse.py) vs Superset(duckdb-engine)")

    try:
        plat = _platform_rows(PROBE_SQL.strip())
        plat_row = tuple(plat["rows"][0])
    except Exception as e:      # noqa: BLE001
        record("플랫폼 경로 조회", False, f"{type(e).__name__}: {str(e)[:140]}")
        return
    record("플랫폼 경로 조회", True, f"컬럼 {len(plat['columns'])}개")

    eng = new_engine()
    try:
        with eng.connect() as cx:
            sup_row = tuple(cx.execute(text(PROBE_SQL.strip())).fetchone())
    except Exception as e:      # noqa: BLE001
        record("Superset 경로 조회", False, f"{type(e).__name__}: {str(e)[:140]}")
        return
    finally:
        eng.dispose()
    record("Superset 경로 조회", True, "")

    # 플랫폼은 이미 _json_safe 를 지나온 값이고 Superset 은 원시 파이썬 객체다.
    # 같은 정규화를 Superset 쪽에도 적용한 뒤 비교한다.
    diffs = []
    for col, a, b in zip(plat["columns"], plat_row, sup_row):
        if _norm(a) != _norm(b):
            diffs.append(f"{col}: 플랫폼={_norm(a)!r} / Superset={_norm(b)!r}")
    record("리터럴 타입 7종 일치", not diffs,
           "; ".join(diffs) if diffs
           else "timestamp · timestamptz · decimal · null · list · struct · map")

    # 실제 테이블도 한 번 본다. 리터럴은 통과해도 Iceberg 컬럼 타입에서 갈릴 수 있다.
    tbl_sql = f"select * from {ALIAS}.{SCHEMA}.fct_apt_trade order by 1 limit 5"  # 원본 직결로 비교
    try:
        p = _platform_rows(tbl_sql)
        eng = new_engine()
        with eng.connect() as cx:
            s = [tuple(r) for r in cx.execute(text(tbl_sql)).fetchall()]
        eng.dispose()
        pn = [[_norm(v) for v in r] for r in p["rows"]]
        sn = [[_norm(v) for v in r] for r in s]
        bad = [f"{i}행 {p['columns'][j]}: {a!r} vs {b!r}"
               for i, (ra, rb) in enumerate(zip(pn, sn))
               for j, (a, b) in enumerate(zip(ra, rb)) if a != b]
        record("fct_apt_trade 상위 5행 일치", not bad,
               "; ".join(bad[:3]) if bad else f"{len(pn)}행 × {len(p['columns'])}컬럼")
    except Exception as e:      # noqa: BLE001
        record("fct_apt_trade 비교", False, f"{type(e).__name__}: {str(e)[:140]}")


# ─────────────────────────────────────────────────────────────
# ④ 스냅샷 신선도 — 커넥션을 붙잡은 채 감시한다
# ─────────────────────────────────────────────────────────────

def rest_snapshot(schema: str, table: str) -> Any:
    """Iceberg REST 카탈로그가 말하는 현재 스냅샷 — 정답 기준값."""
    url = f"{REST_URI}/v1/namespaces/{schema}/tables/{table}"
    with urllib.request.urlopen(url, timeout=10) as r:      # noqa: S310
        meta = json.loads(r.read()).get("metadata", {})
    return meta.get("current-snapshot-id")


def watch(target: str, interval: float = 5.0) -> int:
    """커넥션 하나를 계속 붙잡은 채, 카탈로그와 커넥션이 같은 스냅샷을 보는지 본다.

    Superset 은 커넥션을 풀에 넣고 재사용한다. 붙잡은 커넥션이 낡은 스냅샷을 계속
    보여준다면, 대시보드는 에러 없이 낡은 숫자를 무한정 서브한다 — 설계서 리스크 1.

    이 모드를 켜 둔 상태에서 다른 창에서 적재를 돌린다:
        dbt build --select fct_apt_trade        또는 파이프라인 수동 실행
    """
    from sqlalchemy import text

    schema, _, table = target.partition(".")
    if not table:
        schema, table = SCHEMA, target

    print(f"\n④ 스냅샷 신선도 감시 — {schema}.{table}")
    print("   커넥션 하나를 붙잡고 있습니다. 다른 창에서 적재를 돌리세요.")
    print("   (dbt build --select <모델>  또는 파이프라인 실행) · Ctrl+C 로 종료\n")

    def snap(cx: Any) -> Any:
        """그 커넥션이 «최신» 이라고 보는 스냅샷.

        행수로 판정하면 안 된다 — 증분 모델을 다시 돌려도 원천이 그대로면 행수가
        같아서 갱신됐는지 낡았는지 구분되지 않는다(실측으로 확인: 8행 → 8행,
        스냅샷만 바뀌었다). iceberg_snapshots() 는 그 커넥션이 읽고 있는
        메타데이터의 스냅샷 이력을 그대로 보여준다.
        """
        return cx.execute(text(
            f"select snapshot_id from iceberg_snapshots('{ALIAS}.{schema}.{table}') "
            "order by sequence_number desc limit 1")).scalar()

    # 세 가지 패턴을 같은 적재 한 번으로 비교한다. 원인이 «메타데이터 캐시» 가 아니라
    # «열린 트랜잭션» 이어서, 어느 패턴을 재는지가 결론을 바꾼다.
    #
    #   A) 열린 트랜잭션 유지  — checkout 상태로 계속 붙잡는다. 스냅샷이 고정된다.
    #   B) commit 후 재조회    — 커넥션은 그대로 두고 트랜잭션만 끊는다.
    #   C) 풀 반납 후 재사용   — Superset 의 실제 패턴. **판정 기준은 이것이다.**
    #
    # SQLAlchemy 는 커넥션을 풀에 반납할 때 rollback 한다(pool_reset_on_return 기본값).
    # 그래서 C 가 A 와 다르게 동작한다 — 이 기본값을 바꾸면 전제가 깨진다.
    engA = new_engine()
    held = engA.connect()
    base = snap(held)                       # 여기서 트랜잭션이 열린다

    engC = new_engine()                     # 별도 엔진 — :memory: 는 스레드당 커넥션 공유
    with engC.connect() as c:
        baseC = snap(c)                     # with 를 나가며 rollback + 풀 반납

    base_rest = rest_snapshot(schema, table)
    print(f"   기준값 — 카탈로그 {base_rest}")
    print(f"            A/B 붙잡은 커넥션 {base} · C 풀 반납 {baseC}\n")

    verdict = 2      # 2 = 적재가 없어 판정 못 함
    try:
        while True:
            time.sleep(interval)
            try:
                rest = rest_snapshot(schema, table)
            except Exception as e:      # noqa: BLE001
                print(f"   카탈로그 조회 실패: {str(e)[:80]}")
                continue
            if rest == base_rest:
                print(f"   카탈로그 {rest} → 변경 없음")
                continue

            print(f"\n   적재 감지 — 카탈로그 {base_rest} → {rest}\n")
            mark = lambda s: "최신" if s == rest else "낡음"      # noqa: E731

            a = snap(held)
            print(f"   A) 열린 트랜잭션 유지   → {a}  {mark(a)}")
            held.commit()
            b = snap(held)
            print(f"   B) commit 후 같은 커넥션 → {b}  {mark(b)}")
            with engC.connect() as c:
                cc = snap(c)
            print(f"   C) 풀 반납 후 재사용     → {cc}  {mark(cc)}   ← Superset 의 실제 패턴")

            if cc == rest:
                verdict = 0
                print("\n   ── 판정: 통과 ──")
                print("   Superset 이 쓰는 패턴에서는 최신 스냅샷이 보인다.")
                if a != rest:
                    print("   단, 트랜잭션을 열어둔 채로 두면 그동안 스냅샷이 고정된다(A).")
                    print("   전제 — 커넥션을 풀에 반납하는 것, 즉 pool_reset_on_return 을")
                    print("          기본값(rollback)에서 바꾸지 않는 것.")
                    print("   남는 낡음은 Superset 결과 캐시(DATA_CACHE_CONFIG) 만큼이다.")
            else:
                verdict = 1
                print("\n   ── 판정: 리스크 1 실재 ──")
                print("   풀에 반납하고 다시 꺼내도 낡은 스냅샷을 본다.")
                print("   대응: pool_recycle 로 커넥션 수명 단축 → 그래도 안 되면")
                print("        파이프라인 완료 시 Superset 캐시·커넥션 무효화")
            break
    except KeyboardInterrupt:
        print("\n   중단됨 — 적재가 일어나지 않아 판정하지 못했습니다.")
        return 2
    finally:
        held.close()
        engA.dispose()
        engC.dispose()

    return verdict


# ─────────────────────────────────────────────────────────────

def main() -> int:
    ap = argparse.ArgumentParser(description="P0 — Superset 질의 경로 검증")
    ap.add_argument("--watch", metavar="[스키마.]테이블",
                    help="④ 스냅샷 신선도 감시 모드 (예: analytics.fct_apt_trade)")
    ap.add_argument("--concurrency", type=int, default=10, help="③ 동시 질의 수 (기본 10)")
    args = ap.parse_args()

    print("=" * 68)
    print("P0 — Superset 이 쓸 질의 경로 검증 (Superset 없이)")
    print(f"  Iceberg REST : {REST_URI}")
    print(f"  MinIO        : {MINIO_ENDPOINT}")
    print(f"  카탈로그     : {ALIAS}.{SCHEMA}")
    print("=" * 68)

    try:
        import duckdb
        import duckdb_engine       # noqa: F401
        import sqlalchemy
    except ImportError as e:
        print(f"\n의존성 없음: {e}")
        print("  .venv/bin/pip install duckdb-engine==0.17.0")
        return 3
    print(f"  duckdb {duckdb.__version__} · duckdb-engine · SQLAlchemy {sqlalchemy.__version__}")

    register_hook()

    if args.watch:
        return watch(args.watch)

    check_attach()
    check_tables()
    check_concurrency(args.concurrency)
    check_session_settings()
    check_types()

    print("\n" + "=" * 68)
    failed = [r for r in _results if not r[1]]
    print(f"결과 — {len(_results) - len(failed)} PASS / {len(failed)} FAIL")
    for name, _, note in failed:
        print(f"  FAIL  {name} — {note}")
    print("\n④ 스냅샷 신선도는 적재가 필요하므로 별도로 돌린다:")
    print(f"   .venv/bin/python scripts/p0_duckdb_check.py --watch {SCHEMA}.fct_apt_trade")
    print("=" * 68)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
