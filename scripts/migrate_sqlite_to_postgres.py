#!/usr/bin/env python3
"""SQLite → Postgres 이관 (1회성).

메타스토어와 Iceberg JDBC 카탈로그를 옮긴다. Airflow 메타DB 는 여기서 다루지 않는다 —
Airflow 는 자기 스키마를 `airflow db migrate` 로 직접 만들고, 실행 이력은 다시 쌓이면
그만이라 옮길 이유가 적다(옮기려면 Airflow 쪽 전용 도구가 필요하다).

두 표의 성격이 다르다.
  메타스토어   플랫폼이 소유. 잃으면 파이프라인·수집기 정의가 사라진다.
  카탈로그     테이블 «포인터». 잃으면 MinIO 의 데이터 파일은 남아도 테이블이
               통째로 안 보인다. 이쪽이 훨씬 위험하다.

멱등하다. 같은 키가 이미 있으면 건너뛰므로 여러 번 돌려도 덧쓰지 않는다.
확인만 하려면 --dry-run.

    python scripts/migrate_sqlite_to_postgres.py --dry-run
    python scripts/migrate_sqlite_to_postgres.py
"""

from __future__ import annotations

import argparse
import os
import sqlite3
import sys
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parents[1]

PG_USER = os.environ.get("POSTGRES_USER", "datamates")
PG_PASSWORD = os.environ.get("POSTGRES_PASSWORD", "datamates")
PG_HOST = os.environ.get("POSTGRES_HOST", "localhost")
PG_PORT = os.environ.get("POSTGRES_PORT", "5432")


def pg_url(dbname: str) -> str:
    return f"postgresql://{PG_USER}:{PG_PASSWORD}@{PG_HOST}:{PG_PORT}/{dbname}"


# 메타스토어에서 옮길 표. 순서는 상관없다(외래키가 없다).
# BIGSERIAL 이 붙은 표(model_history, ingest_version)는 id 를 빼고 넣어야
# 시퀀스가 어긋나지 않는다 — 넣은 뒤 다음 INSERT 가 1번을 다시 쓰려 하면 충돌한다.
META_TABLES: list[tuple[str, list[str] | None]] = [
    ("folders", None),
    ("model_folder", None),
    ("pipelines", None),
    ("prefs", None),
    ("graph_layout", None),
    ("model_edge_cfg", None),
    ("model_transform", None),
    ("model_mart", None),
    ("ingest_job", None),
    ("model_history", ["id"]),      # id 는 Postgres 가 새로 매긴다
    ("ingest_version", ["id"]),
    ("credential", None),
    ("run_log", None),
    ("superset_dataset", None),
]

CATALOG_TABLES = ["iceberg_tables", "iceberg_namespace_properties"]


def copy_table(src: sqlite3.Connection, dst: psycopg.Connection, table: str,
               skip: list[str] | None, dry: bool) -> tuple[int, int]:
    """(읽은 행, 넣은 행). 이미 있는 키는 건너뛴다."""
    try:
        rows = src.execute(f'SELECT * FROM "{table}"').fetchall()
    except sqlite3.OperationalError:
        print(f"  {table:24} (원본에 표 없음 — 건너뜀)")
        return 0, 0
    if not rows:
        print(f"  {table:24} 0")
        return 0, 0

    cols = [c for c in rows[0].keys() if not (skip and c in skip)]
    collist = ", ".join(f'"{c}"' for c in cols)
    holders = ", ".join(["%s"] * len(cols))
    sql = f'INSERT INTO "{table}" ({collist}) VALUES ({holders}) ON CONFLICT DO NOTHING'

    if dry:
        print(f"  {table:24} {len(rows):>5} 행 (dry-run)")
        return len(rows), 0

    put = 0
    with dst.cursor() as cur:
        for r in rows:
            cur.execute(sql, tuple(r[c] for c in cols))
            put += cur.rowcount
    print(f"  {table:24} {len(rows):>5} 행 중 {put} 넣음")
    return len(rows), put


def fix_sequences(dst: psycopg.Connection, dry: bool) -> None:
    """BIGSERIAL 시퀀스를 현재 최대값 뒤로 옮긴다.

    ON CONFLICT DO NOTHING 으로 넣어도 시퀀스는 따라 오르지 않는다. 그대로 두면
    다음 INSERT 가 1부터 매기다가 기본키 충돌로 실패한다.
    """
    for table in ("model_history", "ingest_version"):
        if dry:
            print(f"  {table}.id 시퀀스 재설정 (dry-run)")
            continue
        with dst.cursor() as cur:
            cur.execute(
                f"SELECT setval(pg_get_serial_sequence('{table}', 'id'), "
                f"COALESCE((SELECT MAX(id) FROM {table}), 1), true)")
        print(f"  {table}.id 시퀀스 재설정")


def migrate_metastore(sqlite_path: Path, dry: bool) -> bool:
    print(f"\n[메타스토어] {sqlite_path}")
    if not sqlite_path.exists():
        print("  원본이 없다 — 건너뜀")
        return True
    src = sqlite3.connect(f"file:{sqlite_path}?mode=ro", uri=True)
    src.row_factory = sqlite3.Row
    with psycopg.connect(pg_url("datamates")) as dst:
        # 표가 없으면 만든다. 앱과 같은 정의를 쓰려고 store 를 그대로 부른다.
        if not dry:
            sys.path.insert(0, str(ROOT))
            from datamates.app import store
            store.init()
        for table, skip in META_TABLES:
            copy_table(src, dst, table, skip, dry)
        fix_sequences(dst, dry)
        if not dry:
            dst.commit()
    src.close()
    return True


def migrate_catalog(sqlite_path: Path, dry: bool) -> bool:
    print(f"\n[Iceberg 카탈로그] {sqlite_path}")
    if not sqlite_path.exists():
        print("  원본이 없다 — 건너뜀")
        return False
    src = sqlite3.connect(f"file:{sqlite_path}?mode=ro", uri=True)
    src.row_factory = sqlite3.Row
    with psycopg.connect(pg_url("iceberg")) as dst:
        # 표는 Iceberg REST 가 기동 때 만든다. 없으면 아직 안 떴다는 뜻이다.
        with dst.cursor() as cur:
            cur.execute("SELECT to_regclass('public.iceberg_tables') AS t")
            if cur.fetchone()[0] is None:
                print("  iceberg_tables 가 없다 — iceberg-rest 를 먼저 띄워야 한다")
                src.close()
                return False
        for table in CATALOG_TABLES:
            copy_table(src, dst, table, None, dry)
        if not dry:
            dst.commit()
    src.close()
    return True


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="읽기만 하고 넣지 않는다")
    ap.add_argument("--metastore", type=Path,
                    default=ROOT / ".datamates" / "datamates.db")
    ap.add_argument("--catalog", type=Path, required=False,
                    help="백업해 둔 catalog.db 경로 (없으면 카탈로그는 건너뛴다)")
    args = ap.parse_args()

    print(f"대상 Postgres: {PG_HOST}:{PG_PORT} (사용자 {PG_USER})")
    migrate_metastore(args.metastore, args.dry_run)
    if args.catalog:
        migrate_catalog(args.catalog, args.dry_run)
    else:
        print("\n[Iceberg 카탈로그] --catalog 를 주지 않아 건너뛴다")
    print("\n완료" + (" (dry-run — 아무것도 쓰지 않았다)" if args.dry_run else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
