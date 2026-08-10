"""메타스토어 — dbt 가 모르는 것만 담는다.

담는 것: 파이프라인 정의, 카탈로그 폴더, 실행 트리거 기록.
담지 않는 것: 모델 SQL·컬럼·설명·의존관계. 그건 전부 dbt 프로젝트 파일에 있고
manifest.json 을 통해 읽는다. 두 곳에 같은 사실을 두면 반드시 어긋난다.

SQLite 를 쓰는 이유는 이 스택에 새 컨테이너를 늘리지 않기 위해서다
(Airflow 메타DB 도 SQLite 다). 동시 쓰기가 늘면 Postgres 로 옮기면 되고,
아래 함수 시그니처는 그대로 유지된다.
"""

from __future__ import annotations

import json
import sqlite3
import time
from contextlib import contextmanager
from typing import Any, Iterator

from .config import DATA_DIR, DB_PATH

SCHEMA = """
CREATE TABLE IF NOT EXISTS folders (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    grp        TEXT NOT NULL CHECK (grp IN ('SOURCE', 'DATA MODEL')),
    created_at REAL NOT NULL
);

-- 모델 → 폴더 배치. 모델 자체는 dbt 가 소유하므로 여기에는 배치 정보만 둔다.
-- 모델이 지워지면 이 행은 고아가 되지만, 조회할 때 manifest 와 조인하며 걸러진다.
CREATE TABLE IF NOT EXISTS model_folder (
    model_id   TEXT PRIMARY KEY,
    folder_id  TEXT
);

CREATE TABLE IF NOT EXISTS pipelines (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    env         TEXT NOT NULL DEFAULT 'local',
    freq        TEXT NOT NULL DEFAULT '수동 실행',
    retry       INTEGER NOT NULL DEFAULT 1,
    on_fail     TEXT NOT NULL DEFAULT 'stop' CHECK (on_fail IN ('stop', 'go')),
    notify      INTEGER NOT NULL DEFAULT 1,
    targets     TEXT NOT NULL DEFAULT '[]',   -- JSON: 실행 대상 모델 id 목록
    -- 태스크 쪼개기 단위. Spark 세션 기동이 dbt 호출당 약 15초 고정이라,
    -- per_model 은 모델 수에 비례해 그만큼 느려진다. 대신 Airflow 에서
    -- 모델별 상태·재시도·부분 재실행이 그대로 보인다.
    -- single 은 파이프라인 전체를 dbt 한 번으로 돌려 빠르지만 Airflow 에는 상자가 하나다
    -- (모델별 상태는 두 경우 모두 run_results.json 에서 읽는다).
    task_mode   TEXT NOT NULL DEFAULT 'per_model' CHECK (task_mode IN ('per_model', 'single')),
    -- 원천 CSV(dbt seed)를 파이프라인이 함께 적재할지.
    -- 기본은 끔 — seed 는 레포 안의 파일이라 사람이 고칠 때만 바뀌는데, 매 실행마다
    -- 다시 적재하면 Spark 세션 기동(호출당 약 15초)만 seed 수만큼 더 든다.
    -- (측정: 5줄·9줄 CSV 두 개가 133초 파이프라인의 약 60%를 차지했다)
    include_seeds INTEGER NOT NULL DEFAULT 0,
    created_at  REAL NOT NULL,
    updated_at  REAL NOT NULL
);

-- 사용자 설정(역할·기본 환경·알림 수신). 인증이 없는 설치형 단일 사용자 전제라
-- 사용자별로 나누지 않고 키-값으로만 둔다. 다중 사용자가 되면 user_id 를 더한다.
CREATE TABLE IF NOT EXISTS prefs (
    k TEXT PRIMARY KEY,
    v TEXT NOT NULL
);

-- 관계 화면의 카드 위치. 모델 정의가 아니라 보기 상태라 dbt 파일에 넣지 않는다.
CREATE TABLE IF NOT EXISTS graph_layout (
    model_id TEXT PRIMARY KEY,
    x        REAL NOT NULL,
    y        REAL NOT NULL
);

-- 입력 연결의 설명과 변환 설정. 관계 자체는 SQL 의 ref() 가 정하므로 여기 없다.
-- 여기 있는 것은 화면에서 붙인 주석(역할·설명)과 변환 설정 폼의 마지막 상태뿐이다.
CREATE TABLE IF NOT EXISTS model_edge_cfg (
    model_id TEXT NOT NULL,
    from_id  TEXT NOT NULL,
    cfg      TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY (model_id, from_id)
);

CREATE TABLE IF NOT EXISTS model_transform (
    model_id TEXT PRIMARY KEY,
    cfg      TEXT NOT NULL DEFAULT '{}'
);

-- 실행 이력의 원본은 Airflow 다. 여기에는 어떤 의도로 눌렀는지(전체/부분 재실행)만 남긴다.
-- (Airflow 의 dag_run 은 from_node 같은 우리 쪽 개념을 모른다)
CREATE TABLE IF NOT EXISTS ingest_job (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('api', 'file')),
    target      TEXT NOT NULL,                 -- raw.<target> 테이블 이름
    mode        TEXT NOT NULL DEFAULT 'append' CHECK (mode IN ('append', 'overwrite')),
    config      TEXT NOT NULL DEFAULT '{}',    -- JSON: 연결·형식 설정
    columns     TEXT NOT NULL DEFAULT '[]',    -- JSON: 확정된 컬럼 목록
    freq        TEXT NOT NULL DEFAULT '수동 실행',
    retry       INTEGER NOT NULL DEFAULT 1,
    -- 수집은 파이프라인과 달리 선행 트리거가 없다. 예약과 수동뿐이다.
    trigger_type TEXT NOT NULL DEFAULT 'manual' CHECK (trigger_type IN ('schedule', 'manual')),
    created_at  REAL NOT NULL,
    updated_at  REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS model_history (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    model_id TEXT NOT NULL,
    at       REAL NOT NULL,
    entries  TEXT NOT NULL DEFAULT '[]'   -- JSON: [{item, before, after, diff, change}]
);
CREATE INDEX IF NOT EXISTS idx_model_history ON model_history(model_id, at);

CREATE TABLE IF NOT EXISTS run_log (
    dag_run_id  TEXT PRIMARY KEY,
    pipeline_id TEXT NOT NULL,
    from_node   TEXT,
    created_at  REAL NOT NULL
);
"""


def _connect() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    # 읽기가 쓰기를 막지 않게 한다. 카탈로그 조회가 잦고 쓰기는 드문 접근 패턴이다.
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


@contextmanager
def db() -> Iterator[sqlite3.Connection]:
    conn = _connect()
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


# 이미 만들어진 DB 에 뒤늦게 붙는 컬럼들.
# CREATE TABLE IF NOT EXISTS 는 기존 테이블을 그대로 두므로 스키마만 고치면
# 배포된 DB 에는 반영되지 않는다. (테이블, 컬럼, 정의) 를 명시적으로 나열해 더한다.
_MIGRATIONS: list[tuple[str, str, str]] = [
    ("pipelines", "task_mode", "TEXT NOT NULL DEFAULT 'per_model'"),
    ("pipelines", "include_seeds", "INTEGER NOT NULL DEFAULT 0"),
    # 실행 트리거 — schedule(예약) / manual(수동) / upstream(선행 파이프라인 완료 후)
    ("pipelines", "trigger_type", "TEXT NOT NULL DEFAULT 'schedule'"),
    ("pipelines", "upstream_pipeline_id", "TEXT"),
]


def init() -> None:
    with db() as conn:
        conn.executescript(SCHEMA)
        for table, column, ddl in _MIGRATIONS:
            have = {r["name"] for r in conn.execute(f"PRAGMA table_info({table})")}
            if not have:            # 테이블 자체가 없으면 SCHEMA 가 방금 만들었다
                continue
            if column not in have:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")


# ------------------------------------------------------------ 데이터 수집

_ING_COLS = ("id", "name", "kind", "target", "mode", "config", "columns",
             "freq", "retry", "trigger_type", "created_at", "updated_at")


def _ing_row(r: sqlite3.Row) -> dict[str, Any]:
    d = dict(r)
    d["config"] = json.loads(d["config"])
    d["columns"] = json.loads(d["columns"])
    return d


def ingest_jobs() -> list[dict[str, Any]]:
    with db() as conn:
        return [_ing_row(r) for r in conn.execute(
            f"SELECT {', '.join(_ING_COLS)} FROM ingest_job ORDER BY created_at DESC")]


def ingest_get(jid: str) -> dict[str, Any] | None:
    with db() as conn:
        r = conn.execute(f"SELECT {', '.join(_ING_COLS)} FROM ingest_job WHERE id = ?",
                         (jid,)).fetchone()
        return _ing_row(r) if r else None


def ingest_by_target(target: str) -> dict[str, Any] | None:
    """한 raw 테이블의 적재는 수집 작업 하나만 맡는다 — 그 소유자를 찾는다."""
    with db() as conn:
        r = conn.execute(
            f"SELECT {', '.join(_ING_COLS)} FROM ingest_job WHERE target = ?",
            (target,)).fetchone()
        return _ing_row(r) if r else None


def ingest_upsert(jid: str, fields: dict[str, Any]) -> dict[str, Any]:
    now = time.time()
    existing = ingest_get(jid)
    merged = {"name": "", "kind": "api", "target": "", "mode": "append",
              "config": {}, "columns": [], "freq": "수동 실행", "retry": 1,
              "trigger_type": "manual"}
    if existing:
        merged.update({k: existing[k] for k in merged})
    merged.update({k: v for k, v in fields.items() if k in merged and v is not None})

    with db() as conn:
        conn.execute(
            """INSERT INTO ingest_job
                 (id, name, kind, target, mode, config, columns, freq, retry,
                  trigger_type, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 name=excluded.name, kind=excluded.kind, target=excluded.target,
                 mode=excluded.mode, config=excluded.config, columns=excluded.columns,
                 freq=excluded.freq, retry=excluded.retry,
                 trigger_type=excluded.trigger_type, updated_at=excluded.updated_at""",
            (jid, merged["name"], merged["kind"], merged["target"], merged["mode"],
             json.dumps(merged["config"], ensure_ascii=False),
             json.dumps(merged["columns"], ensure_ascii=False),
             merged["freq"], int(merged["retry"]), merged["trigger_type"],
             existing["created_at"] if existing else now, now))
    return ingest_get(jid)  # type: ignore[return-value]


def ingest_delete(jid: str) -> None:
    with db() as conn:
        conn.execute("DELETE FROM ingest_job WHERE id = ?", (jid,))


# ------------------------------------------------------------ 모델 변경 이력

def history_add(model_id: str, entries: list[dict[str, Any]]) -> None:
    with db() as conn:
        conn.execute(
            "INSERT INTO model_history (model_id, at, entries) VALUES (?, ?, ?)",
            (model_id, time.time(), json.dumps(entries, ensure_ascii=False)))


def history_list(model_id: str, limit: int = 50) -> list[dict[str, Any]]:
    with db() as conn:
        rows = conn.execute(
            "SELECT at, entries FROM model_history WHERE model_id = ? "
            "ORDER BY at DESC LIMIT ?", (model_id, int(limit))).fetchall()
    return [{"at": r["at"], "entries": json.loads(r["entries"])} for r in rows]


# ---------------------------------------------------------------- 폴더

def folders() -> list[dict[str, Any]]:
    with db() as conn:
        return [dict(r) for r in conn.execute(
            "SELECT id, name, grp FROM folders ORDER BY grp, name")]


def folder_get(fid: str) -> dict[str, Any] | None:
    with db() as conn:
        r = conn.execute("SELECT id, name, grp FROM folders WHERE id = ?", (fid,)).fetchone()
        return dict(r) if r else None


def folder_create(fid: str, name: str, grp: str) -> dict[str, Any]:
    with db() as conn:
        conn.execute("INSERT INTO folders (id, name, grp, created_at) VALUES (?, ?, ?, ?)",
                     (fid, name, grp, time.time()))
    return {"id": fid, "name": name, "grp": grp}


def folder_rename(fid: str, name: str) -> None:
    with db() as conn:
        conn.execute("UPDATE folders SET name = ? WHERE id = ?", (name, fid))


def folder_delete(fid: str) -> None:
    """폴더를 지우고 안에 있던 모델은 폴더 없음 으로 내보낸다. 모델 자체는 그대로다."""
    with db() as conn:
        conn.execute("UPDATE model_folder SET folder_id = NULL WHERE folder_id = ?", (fid,))
        conn.execute("DELETE FROM folders WHERE id = ?", (fid,))


def model_folders() -> dict[str, str | None]:
    with db() as conn:
        return {r["model_id"]: r["folder_id"]
                for r in conn.execute("SELECT model_id, folder_id FROM model_folder")}


def model_folder_set(model_id: str, folder_id: str | None) -> None:
    with db() as conn:
        conn.execute(
            "INSERT INTO model_folder (model_id, folder_id) VALUES (?, ?) "
            "ON CONFLICT(model_id) DO UPDATE SET folder_id = excluded.folder_id",
            (model_id, folder_id))


# ---------------------------------------------------------------- 파이프라인

_PIPE_COLS = ("id", "name", "description", "env", "freq", "retry",
              "on_fail", "notify", "targets", "task_mode", "include_seeds",
              "trigger_type", "upstream_pipeline_id",
              "created_at", "updated_at")


def _pipe_row(r: sqlite3.Row) -> dict[str, Any]:
    d = dict(r)
    d["targets"] = json.loads(d["targets"])
    d["notify"] = bool(d["notify"])
    d["include_seeds"] = bool(d["include_seeds"])
    return d


def pipelines() -> list[dict[str, Any]]:
    with db() as conn:
        return [_pipe_row(r) for r in conn.execute(
            f"SELECT {', '.join(_PIPE_COLS)} FROM pipelines ORDER BY created_at DESC")]


def pipeline_get(pid: str) -> dict[str, Any] | None:
    with db() as conn:
        r = conn.execute(
            f"SELECT {', '.join(_PIPE_COLS)} FROM pipelines WHERE id = ?", (pid,)).fetchone()
        return _pipe_row(r) if r else None


def pipeline_upsert(pid: str, fields: dict[str, Any]) -> dict[str, Any]:
    now = time.time()
    existing = pipeline_get(pid)
    merged = {
        "name": "", "description": "", "env": "local",
        "freq": "수동 실행", "retry": 1, "on_fail": "stop", "notify": True,
        "targets": [], "task_mode": "per_model", "include_seeds": False,
        "trigger_type": "schedule", "upstream_pipeline_id": None,
    }
    if existing:
        merged.update({k: existing[k] for k in merged})
    # upstream_pipeline_id 는 None 이 «연결 해제»라는 뜻이라 None 도 반영해야 한다.
    merged.update({k: v for k, v in fields.items()
                   if k in merged and (v is not None or k == "upstream_pipeline_id")})

    with db() as conn:
        conn.execute(
            """INSERT INTO pipelines
                 (id, name, description, env, freq, retry, on_fail, notify,
                  targets, task_mode, include_seeds,
                  trigger_type, upstream_pipeline_id, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 name=excluded.name, description=excluded.description,
                 env=excluded.env, freq=excluded.freq, retry=excluded.retry,
                 on_fail=excluded.on_fail, notify=excluded.notify,
                 targets=excluded.targets, task_mode=excluded.task_mode,
                 include_seeds=excluded.include_seeds,
                 trigger_type=excluded.trigger_type,
                 upstream_pipeline_id=excluded.upstream_pipeline_id,
                 updated_at=excluded.updated_at""",
            (pid, merged["name"], merged["description"], merged["env"],
             merged["freq"], int(merged["retry"]), merged["on_fail"], int(merged["notify"]),
             json.dumps(merged["targets"], ensure_ascii=False), merged["task_mode"],
             int(merged["include_seeds"]),
             merged["trigger_type"], merged["upstream_pipeline_id"],
             existing["created_at"] if existing else now, now))
    return pipeline_get(pid)  # type: ignore[return-value]


def pipeline_delete(pid: str) -> None:
    with db() as conn:
        conn.execute("DELETE FROM run_log WHERE pipeline_id = ?", (pid,))
        conn.execute("DELETE FROM pipelines WHERE id = ?", (pid,))


# ---------------------------------------------------------------- 실행 기록

def run_log_add(dag_run_id: str, pipeline_id: str,
                from_node: str | None) -> None:
    with db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO run_log "
            "(dag_run_id, pipeline_id, from_node, created_at) "
            "VALUES (?, ?, ?, ?)",
            (dag_run_id, pipeline_id, from_node, time.time()))


def run_log_get(dag_run_id: str) -> dict[str, Any] | None:
    with db() as conn:
        r = conn.execute(
            "SELECT dag_run_id, pipeline_id, from_node, created_at "
            "FROM run_log WHERE dag_run_id = ?", (dag_run_id,)).fetchone()
        return dict(r) if r else None


# ---------------------------------------------------------------- 모델 부가 설정

def edge_cfg_all(model_id: str) -> dict[str, dict[str, Any]]:
    with db() as conn:
        return {r["from_id"]: json.loads(r["cfg"]) for r in conn.execute(
            "SELECT from_id, cfg FROM model_edge_cfg WHERE model_id = ?", (model_id,))}


def edge_cfg_set(model_id: str, from_id: str, cfg: dict[str, Any]) -> None:
    with db() as conn:
        conn.execute(
            "INSERT INTO model_edge_cfg (model_id, from_id, cfg) VALUES (?, ?, ?) "
            "ON CONFLICT(model_id, from_id) DO UPDATE SET cfg = excluded.cfg",
            (model_id, from_id, json.dumps(cfg, ensure_ascii=False)))


def transform_get(model_id: str) -> dict[str, Any] | None:
    with db() as conn:
        r = conn.execute("SELECT cfg FROM model_transform WHERE model_id = ?",
                         (model_id,)).fetchone()
        return json.loads(r["cfg"]) if r else None


def transform_set(model_id: str, cfg: dict[str, Any]) -> None:
    with db() as conn:
        conn.execute(
            "INSERT INTO model_transform (model_id, cfg) VALUES (?, ?) "
            "ON CONFLICT(model_id) DO UPDATE SET cfg = excluded.cfg",
            (model_id, json.dumps(cfg, ensure_ascii=False)))


# ---------------------------------------------------------------- 설정

def pref_get(key: str, default: str = "") -> str:
    with db() as conn:
        r = conn.execute("SELECT v FROM prefs WHERE k = ?", (key,)).fetchone()
        return r["v"] if r else default


def pref_set(key: str, value: str) -> None:
    with db() as conn:
        conn.execute("INSERT INTO prefs (k, v) VALUES (?, ?) "
                     "ON CONFLICT(k) DO UPDATE SET v = excluded.v", (key, str(value)))


# ---------------------------------------------------------------- 관계 화면 배치

def layout_get() -> dict[str, dict[str, float]]:
    with db() as conn:
        return {r["model_id"]: {"x": r["x"], "y": r["y"]}
                for r in conn.execute("SELECT model_id, x, y FROM graph_layout")}


def layout_set(positions: dict[str, dict[str, float]]) -> None:
    with db() as conn:
        for mid, p in positions.items():
            conn.execute(
                "INSERT INTO graph_layout (model_id, x, y) VALUES (?, ?, ?) "
                "ON CONFLICT(model_id) DO UPDATE SET x = excluded.x, y = excluded.y",
                (mid, float(p.get("x", 0)), float(p.get("y", 0))))
