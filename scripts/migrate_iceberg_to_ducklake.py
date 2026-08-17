#!/usr/bin/env python3
"""Iceberg → DuckLake 이관 (1회성).

기존 Iceberg REST 카탈로그의 모든 네임스페이스·테이블을 DuckLake 로 복사한다.
Iceberg 쪽은 **읽기 전용으로만** 붙는다 — 원본은 그대로 남아 롤백 경로가 된다.

멱등하다: 이미 존재하는 테이블은 건너뛴다(재실행해도 덧쓰지 않는다).
복사 후 테이블마다 행수를 대조하고, 하나라도 어긋나면 종료 코드 1.

    python scripts/migrate_iceberg_to_ducklake.py --dry-run
    python scripts/migrate_iceberg_to_ducklake.py
"""

from __future__ import annotations

import argparse
import os
import sys
import time

import duckdb

ICEBERG_REST = os.environ.get("ICEBERG_REST_URI", "http://localhost:8181")
MINIO = os.environ.get("MINIO_ENDPOINT", "http://localhost:9000")
MINIO_USER = os.environ.get("MINIO_ROOT_USER", "minioadmin")
MINIO_PASSWORD = os.environ.get("MINIO_ROOT_PASSWORD", "minioadmin")
PG_HOST = os.environ.get("POSTGRES_HOST", "localhost")
PG_PORT = os.environ.get("POSTGRES_PORT", "5432")
PG_USER = os.environ.get("POSTGRES_USER", "datamates")
PG_PASSWORD = os.environ.get("POSTGRES_PASSWORD", "datamates")

DUCKLAKE = (f"ducklake:postgres:dbname=ducklake host={PG_HOST} port={PG_PORT} "
            f"user={PG_USER} password={PG_PASSWORD}")

# 게이트 검증이 만든 스크래치 스키마. 이관 대상이 아니다.
SKIP_SCHEMAS = {"gate", "gate2", "wtest_scratch", "main", "information_schema", "pg_catalog"}


def connect() -> duckdb.DuckDBPyConnection:
    con = duckdb.connect()
    con.execute("INSTALL iceberg; INSTALL ducklake; INSTALL postgres;")
    # 시간대를 고정해야 timestamptz 의 «표기» 가 흔들리지 않는다. 값(순간)은
    # 어느 쪽이든 보존되지만, 검증 출력을 비교할 때 헷갈릴 이유를 없앤다.
    con.execute("SET TimeZone = 'UTC';")
    host = MINIO.split("://", 1)[-1].rstrip("/")
    ssl = MINIO.startswith("https://")
    con.execute(
        "CREATE OR REPLACE SECRET mig_s3 (TYPE s3, KEY_ID ?, SECRET ?, ENDPOINT ?, "
        "USE_SSL ?, URL_STYLE 'path', REGION 'us-east-1')",
        [MINIO_USER, MINIO_PASSWORD, host, ssl])
    con.execute(
        "ATTACH 'warehouse' AS iceold (TYPE iceberg, ENDPOINT ?, "
        "AUTHORIZATION_TYPE 'none', READ_ONLY)", [ICEBERG_REST])
    con.execute(f"ATTACH '{DUCKLAKE}' AS lake")
    return con


def iceberg_tables(con: duckdb.DuckDBPyConnection) -> list[tuple[str, str]]:
    rows = con.execute(
        "SELECT table_schema, table_name FROM information_schema.tables "
        "WHERE table_catalog = 'iceold' ORDER BY 1, 2").fetchall()
    return [(s, t) for s, t in rows if s not in SKIP_SCHEMAS]


def lake_has(con: duckdb.DuckDBPyConnection, schema: str, table: str) -> bool:
    return con.execute(
        "SELECT count(*) FROM information_schema.tables "
        "WHERE table_catalog = 'lake' AND table_schema = ? AND table_name = ?",
        [schema, table]).fetchone()[0] > 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    con = connect()
    tables = iceberg_tables(con)
    print(f"원본(Iceberg): 테이블 {len(tables)}개\n")

    failed, copied, skipped = [], 0, 0
    for schema, table in tables:
        label = f"{schema}.{table}"
        if lake_has(con, schema, table):
            n = con.execute(f'SELECT count(*) FROM lake."{schema}"."{table}"').fetchone()[0]
            print(f"  = {label:44} 이미 있음 ({n}행) — 건너뜀")
            skipped += 1
            continue
        if args.dry_run:
            n = con.execute(f'SELECT count(*) FROM iceold."{schema}"."{table}"').fetchone()[0]
            print(f"  · {label:44} {n:>8}행 (dry-run)")
            continue
        t0 = time.perf_counter()
        con.execute(f'CREATE SCHEMA IF NOT EXISTS lake."{schema}"')
        con.execute(f'CREATE TABLE lake."{schema}"."{table}" AS '
                    f'SELECT * FROM iceold."{schema}"."{table}"')
        src = con.execute(f'SELECT count(*) FROM iceold."{schema}"."{table}"').fetchone()[0]
        dst = con.execute(f'SELECT count(*) FROM lake."{schema}"."{table}"').fetchone()[0]
        ms = (time.perf_counter() - t0) * 1000
        mark = "✅" if src == dst else "❌"
        print(f"  {mark} {label:44} {dst:>8}행  {ms:7.0f}ms" +
              ("" if src == dst else f"  (원본 {src}행 — 불일치!)"))
        if src != dst:
            failed.append(label)
        else:
            copied += 1

    print(f"\n복사 {copied} · 건너뜀 {skipped} · 실패 {len(failed)}")
    if failed:
        print("불일치:", ", ".join(failed))
    con.close()
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
