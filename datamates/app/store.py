"""메타스토어 — dbt 가 모르는 것만 담는다.

담는 것: 파이프라인 정의, 카탈로그 폴더, 실행 트리거 기록.
담지 않는 것: 모델 SQL·컬럼·설명·의존관계. 그건 전부 dbt 프로젝트 파일에 있고
manifest.json 을 통해 읽는다. 두 곳에 같은 사실을 두면 반드시 어긋난다.

저장소는 Postgres 다(docker-compose.yml 의 postgres 서비스). 원래는 컨테이너를
늘리지 않으려고 SQLite 였는데, 동시 쓰기가 늘어 옮겼다 — SQLite 는 writer 가
하나뿐이라 수집과 파이프라인 저장이 겹치면 뒤에 온 쪽이 기다린다.
Airflow 메타DB·Iceberg 카탈로그도 같은 인스턴스를 쓴다(DB 이름만 다르다).

드라이버는 psycopg 3 이다. `conn.execute(...).fetchone()` 과 dict 행 접근을
그대로 쓸 수 있어 SQLite 시절 호출부를 손대지 않고 넘어올 수 있었다
(psycopg 2 는 커서를 따로 떠야 해서 51곳을 전부 고쳐야 했다).
"""

from __future__ import annotations

import json
import time
from contextlib import contextmanager
from typing import Any, Iterator

import psycopg
from psycopg.rows import dict_row

from .config import DATABASE_URL

SCHEMA = """
CREATE TABLE IF NOT EXISTS folders (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    grp        TEXT NOT NULL CHECK (grp IN ('SOURCE', 'DATA MODEL')),
    created_at DOUBLE PRECISION NOT NULL
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
    created_at  DOUBLE PRECISION NOT NULL,
    updated_at  DOUBLE PRECISION NOT NULL
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
    x        DOUBLE PRECISION NOT NULL,
    y        DOUBLE PRECISION NOT NULL
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

-- 품질 규칙의 실행 결과. dbt 는 실행 하나의 결과만 run_results.json 에 남기고
-- 지난 실행 것은 덮어쓴다. 그래서 결과를 «가장 최근 실행 1건» 에서만 읽으면,
-- 모델 하나만 다시 돌린 순간 나머지 규칙 전부가 «아직 안 돌았음» 이 된다
-- (실측: 52개 중 51개가 그렇게 사라져 통과율이 100%로 표시됐다 — 분모가 0이라).
--
-- 그래서 읽을 때마다 여기에 쌓는다. (규칙, 실행) 을 키로 두어 같은 실행을 몇 번
-- 읽어도 한 줄이고, 규칙별 «마지막 결과» 와 «날짜별 통과율» 이 둘 다 나온다.
CREATE TABLE IF NOT EXISTS rule_result (
    rule_uid TEXT NOT NULL,              -- dbt 테스트 unique_id
    run_id   TEXT NOT NULL,              -- Airflow dag_run_id
    model_id TEXT NOT NULL DEFAULT '',
    status   TEXT NOT NULL,              -- ok | warn | err
    failures INTEGER NOT NULL DEFAULT 0,
    at       DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (rule_uid, run_id)
);
CREATE INDEX IF NOT EXISTS idx_rule_result_at ON rule_result(at);
CREATE INDEX IF NOT EXISTS idx_rule_result_uid ON rule_result(rule_uid, at);

-- DATA MART 지정. 마트는 별도의 객체가 아니라 데이터 모델에 부여하는 «역할»이라
-- 여기에는 어떤 모델이 마트인지만 둔다. 이름·SQL·컬럼은 그대로 dbt 것이다.
--
-- dbt 가 모르는 사실이라 메타스토어에 둔다. dbt 태그로 둘 수도 있지만 그러면
-- 지정·해제가 schema.yml 쓰기 + dbt parse(약 5초)가 되고, 해제 차단(분석에서
-- 사용 중)을 파일 쓰기 전에 판단해야 해서 흐름이 뒤집힌다.
CREATE TABLE IF NOT EXISTS model_mart (
    model_id  TEXT PRIMARY KEY,
    marked_at DOUBLE PRECISION NOT NULL
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
    scope       TEXT NOT NULL DEFAULT '{}',    -- JSON: 수집 범위(전체/증분)
    watermark   TEXT,                          -- 증분 수집이 덮은 마지막 시점 (ISO)
    created_at  DOUBLE PRECISION NOT NULL,
    updated_at  DOUBLE PRECISION NOT NULL
);

CREATE TABLE IF NOT EXISTS model_history (
    id       BIGSERIAL PRIMARY KEY,
    model_id TEXT NOT NULL,
    at       DOUBLE PRECISION NOT NULL,
    entries  TEXT NOT NULL DEFAULT '[]'   -- JSON: [{item, before, after, diff, change}]
);
CREATE INDEX IF NOT EXISTS idx_model_history ON model_history(model_id, at);

-- 수집 커넥터의 버전 이력.
--
-- model_history 와 나란한 표지만 모양이 다르다. 모델은 «무엇이 어떻게 바뀌었나»를
-- 항목별 diff 로 남기는 반면(SQL 이 원천이라 되돌릴 근거가 파일에 있다), 커넥터는
-- 정의 자체가 이 DB 에만 있어서 **그때의 정의를 통째로**(snapshot) 들고 있어야
-- «v2 로 되돌리기» 가 가능하다. note 는 사람이 읽을 한 줄 요약이다.
--
-- ver 는 커넥터마다 1 부터 센다. 전역 일련번호를 쓰면 화면의 «v4» 가 그 커넥터가
-- 네 번 고쳐졌다는 뜻이 아니게 된다.
CREATE TABLE IF NOT EXISTS ingest_version (
    id       BIGSERIAL PRIMARY KEY,
    job_id   TEXT NOT NULL,
    ver      INTEGER NOT NULL,
    note     TEXT NOT NULL DEFAULT '',
    at       DOUBLE PRECISION NOT NULL,
    snapshot TEXT NOT NULL DEFAULT '{}'    -- JSON: 그 시점의 커넥터 정의(비밀 제외)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ingest_version ON ingest_version(job_id, ver);

-- 자격증명 — 커넥터가 원천에 붙을 때 쓰는 비밀 값을 한곳에 모은다.
--
-- 예전에는 커넥터 config.auth 안에 값이 직접 들어 있었다. 그러면 같은 서비스 키를
-- 쓰는 커넥터가 셋이면 사본이 셋이고, 키를 갱신할 때 하나를 빠뜨리면 그 커넥터만
-- 조용히 실패한다. 만료일을 둔 이유도 같다 — 만료는 키의 속성이지 커넥터의 속성이
-- 아니라서, 커넥터마다 적어 두면 어느 것이 진짜인지 알 수 없다.
--
-- secret 은 여기서만 읽고 응답에는 절대 싣지 않는다(라우터의 _cred_view).
CREATE TABLE IF NOT EXISTS credential (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    kind       TEXT NOT NULL DEFAULT 'param'
               CHECK (kind IN ('bearer', 'header', 'param')),
    param      TEXT NOT NULL DEFAULT '',     -- 헤더·질의 파라미터 이름 (bearer 면 빈값)
    secret     TEXT NOT NULL DEFAULT '',
    expires_at TEXT,                         -- ISO 날짜. 없으면 만료 없음
    note       TEXT NOT NULL DEFAULT '',
    created_at DOUBLE PRECISION NOT NULL,
    updated_at DOUBLE PRECISION NOT NULL
);

CREATE TABLE IF NOT EXISTS run_log (
    dag_run_id  TEXT PRIMARY KEY,
    pipeline_id TEXT NOT NULL,
    from_node   TEXT,
    created_at  DOUBLE PRECISION NOT NULL
);

-- 데이터 모델 ↔ Superset 데이터셋. 분석 기능의 «관계를 따로 저장하지 않는다» 예외다.
--
-- dbt manifest 가 단일 원천이라는 원칙은 그대로다 — 이 표는 원천이 아니라
-- «플랫폼이 만든 Superset 객체의 주소록» 이다. 없으면 물리명으로 매칭해야 하고,
-- 그러면 모델 이름이 바뀌는 순간 연결이 끊긴다.
--
-- embed_uuid 는 대시보드용이 아니라 데이터셋용이 아니므로 두지 않는다.
CREATE TABLE IF NOT EXISTS superset_dataset (
    model_id   TEXT PRIMARY KEY,
    dataset_id INTEGER NOT NULL,
    phys       TEXT NOT NULL,      -- 동기화 당시의 물리 위치. 바뀌면 다시 만든다
    synced_at  DOUBLE PRECISION NOT NULL,
    state      TEXT NOT NULL DEFAULT 'ok'   -- ok | stale | orphan
);
CREATE INDEX IF NOT EXISTS idx_superset_dataset_id
    ON superset_dataset(dataset_id);
"""


def _connect() -> psycopg.Connection:
    # dict_row 로 뜨면 r["name"] 처럼 이름으로 읽는다 — sqlite3.Row 와 같은 사용감이라
    # 호출부를 고치지 않아도 된다.
    #
    # SQLite 때 걸던 PRAGMA 두 개는 없앴다. journal_mode=WAL 은 「읽기가 쓰기를 막지
    # 않게」 하는 설정인데 Postgres 는 MVCC 라 기본이 그렇고, foreign_keys=ON 도
    # Postgres 에서는 항상 켜져 있다.
    return psycopg.connect(DATABASE_URL, row_factory=dict_row, connect_timeout=10)


@contextmanager
def db() -> Iterator[psycopg.Connection]:
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
    # 수집 범위 — JSON. 전체 수집이면 비어 있고, 증분 수집이면 기준·파라미터가 들어간다.
    ("ingest_job", "scope", "TEXT NOT NULL DEFAULT '{}'"),
    # 증분 수집이 어디까지 가져왔는지. 사람이 고치는 값이 아니라 실행이 남기는 값이라
    # config 가 아니라 별도 컬럼에 둔다 — 설정을 수정해도 지워지면 안 된다.
    ("ingest_job", "watermark", "TEXT"),
    # 중복 기준 — 이 컬럼(들)이 같으면 한 행만 남긴다. 비어 있으면 원본 그대로 넣는다.
    # 쉼표로 여러 컬럼을 줄 수 있다.
    ("ingest_job", "dedupe", "TEXT NOT NULL DEFAULT ''"),
]


def init() -> None:
    with db() as conn:
        # psycopg 는 파라미터 없는 execute 에 여러 문장을 한 번에 넘길 수 있다
        # (sqlite3 의 executescript 자리).
        conn.execute(SCHEMA)
        for table, column, ddl in _MIGRATIONS:
            # SQLite 의 PRAGMA table_info 자리. 결과 모양이 달라서 컬럼 이름만 뽑는다.
            have = {r["column_name"] for r in conn.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_schema = current_schema() AND table_name = %s", (table,))}
            if not have:            # 테이블 자체가 없으면 SCHEMA 가 방금 만들었다
                continue
            if column not in have:
                # IF NOT EXISTS 가 있어도 위 검사를 남긴다 — 어떤 컬럼이 실제로
                # 더해졌는지 로그로 볼 수 있어야 이관 사고를 알아챈다.
                conn.execute(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} {ddl}")


# ------------------------------------------------------------ 데이터 수집

_ING_COLS = ("id", "name", "kind", "target", "mode", "config", "columns",
             "freq", "retry", "trigger_type", "scope", "watermark", "dedupe",
             "created_at", "updated_at")


def _ing_row(r: dict[str, Any]) -> dict[str, Any]:
    d = dict(r)
    d["config"] = json.loads(d["config"])
    d["columns"] = json.loads(d["columns"])
    d["scope"] = json.loads(d.get("scope") or "{}")
    return d


def ingest_jobs() -> list[dict[str, Any]]:
    with db() as conn:
        return [_ing_row(r) for r in conn.execute(
            f"SELECT {', '.join(_ING_COLS)} FROM ingest_job ORDER BY created_at DESC")]


def ingest_get(jid: str) -> dict[str, Any] | None:
    with db() as conn:
        r = conn.execute(f"SELECT {', '.join(_ING_COLS)} FROM ingest_job WHERE id = %s",
                         (jid,)).fetchone()
        return _ing_row(r) if r else None


def ingest_by_target(target: str) -> dict[str, Any] | None:
    """한 raw 테이블의 적재는 수집 작업 하나만 맡는다 — 그 소유자를 찾는다."""
    with db() as conn:
        r = conn.execute(
            f"SELECT {', '.join(_ING_COLS)} FROM ingest_job WHERE target = %s",
            (target,)).fetchone()
        return _ing_row(r) if r else None


def ingest_upsert(jid: str, fields: dict[str, Any]) -> dict[str, Any]:
    now = time.time()
    existing = ingest_get(jid)
    merged = {"name": "", "kind": "api", "target": "", "mode": "append",
              "config": {}, "columns": [], "freq": "수동 실행", "retry": 1,
              "trigger_type": "manual", "scope": {}, "dedupe": ""}
    if existing:
        merged.update({k: existing[k] for k in merged})
    merged.update({k: v for k, v in fields.items() if k in merged and v is not None})

    # 워터마크는 실행이 남기는 값이라 저장에서 건드리지 않는다. 설정을 고쳤다고
    # 어디까지 가져왔는지가 초기화되면 같은 구간을 다시 긁는다.
    with db() as conn:
        conn.execute(
            """INSERT INTO ingest_job
                 (id, name, kind, target, mode, config, columns, freq, retry,
                  trigger_type, scope, dedupe, created_at, updated_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT(id) DO UPDATE SET
                 name=excluded.name, kind=excluded.kind, target=excluded.target,
                 mode=excluded.mode, config=excluded.config, columns=excluded.columns,
                 freq=excluded.freq, retry=excluded.retry,
                 trigger_type=excluded.trigger_type, scope=excluded.scope,
                 dedupe=excluded.dedupe, updated_at=excluded.updated_at""",
            (jid, merged["name"], merged["kind"], merged["target"], merged["mode"],
             json.dumps(merged["config"], ensure_ascii=False),
             json.dumps(merged["columns"], ensure_ascii=False),
             merged["freq"], int(merged["retry"]), merged["trigger_type"],
             json.dumps(merged["scope"], ensure_ascii=False), merged["dedupe"],
             existing["created_at"] if existing else now, now))
    return ingest_get(jid)  # type: ignore[return-value]


# ------------------------------------------------------------ 커넥터 버전 이력

def ingest_versions(jid: str, limit: int = 50) -> list[dict[str, Any]]:
    with db() as conn:
        rows = conn.execute(
            "SELECT ver, note, at, snapshot FROM ingest_version WHERE job_id = %s "
            "ORDER BY ver DESC LIMIT %s", (jid, int(limit))).fetchall()
    return [{"ver": r["ver"], "note": r["note"], "at": r["at"],
             "snapshot": json.loads(r["snapshot"])} for r in rows]


def ingest_version_last(jid: str) -> int:
    with db() as conn:
        r = conn.execute("SELECT MAX(ver) AS v FROM ingest_version WHERE job_id = %s",
                         (jid,)).fetchone()
    return int(r["v"] or 0)


def ingest_version_add(jid: str, note: str, snapshot: dict[str, Any],
                       at: float | None = None) -> int:
    """다음 판을 남기고 그 번호를 돌려준다.

    at 은 이력이 생기기 전에 만들어진 커넥터를 뒤늦게 채울 때만 준다(기동 시 보정).
    그때 지금 시각을 찍으면 «오늘 만들어진 커넥터» 가 되어 버린다.
    """
    ver = ingest_version_last(jid) + 1
    with db() as conn:
        conn.execute(
            "INSERT INTO ingest_version (job_id, ver, note, at, snapshot) "
            "VALUES (%s, %s, %s, %s, %s)",
            (jid, ver, note, time.time() if at is None else at,
             json.dumps(snapshot, ensure_ascii=False)))
    return ver


def ingest_versions_delete(jid: str) -> None:
    with db() as conn:
        conn.execute("DELETE FROM ingest_version WHERE job_id = %s", (jid,))


# ------------------------------------------------------------ 자격증명

_CRED_COLS = ("id", "name", "kind", "param", "secret", "expires_at", "note",
              "created_at", "updated_at")


def credentials() -> list[dict[str, Any]]:
    with db() as conn:
        return [dict(r) for r in conn.execute(
            f"SELECT {', '.join(_CRED_COLS)} FROM credential ORDER BY name")]


def credential_get(cid: str) -> dict[str, Any] | None:
    with db() as conn:
        r = conn.execute(
            f"SELECT {', '.join(_CRED_COLS)} FROM credential WHERE id = %s",
            (cid,)).fetchone()
        return dict(r) if r else None


def credential_upsert(cid: str, fields: dict[str, Any]) -> dict[str, Any]:
    now = time.time()
    existing = credential_get(cid)
    merged = {"name": "", "kind": "param", "param": "", "secret": "",
              "expires_at": None, "note": ""}
    if existing:
        merged.update({k: existing[k] for k in merged})
    # 비밀은 빈 문자열로 오면 «바꾸지 않음» 이다. 화면이 마스킹된 빈 값을 그대로
    # 돌려보내므로, 이름만 고쳐도 키가 지워지는 것을 막는다.
    for k, v in fields.items():
        if k not in merged or v is None:
            continue
        if k == "secret" and v == "" and existing:
            continue
        merged[k] = v

    with db() as conn:
        conn.execute(
            """INSERT INTO credential
                 (id, name, kind, param, secret, expires_at, note, created_at, updated_at)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT(id) DO UPDATE SET
                 name=excluded.name, kind=excluded.kind, param=excluded.param,
                 secret=excluded.secret, expires_at=excluded.expires_at,
                 note=excluded.note, updated_at=excluded.updated_at""",
            (cid, merged["name"], merged["kind"], merged["param"], merged["secret"],
             merged["expires_at"], merged["note"],
             existing["created_at"] if existing else now, now))
    return credential_get(cid)  # type: ignore[return-value]


def credential_delete(cid: str) -> None:
    with db() as conn:
        conn.execute("DELETE FROM credential WHERE id = %s", (cid,))


def ingest_mark(jid: str, watermark: str) -> None:
    """증분 수집이 어디까지 덮었는지 기록한다. 적재가 성공했을 때만 부른다."""
    with db() as conn:
        conn.execute("UPDATE ingest_job SET watermark = %s WHERE id = %s", (watermark, jid))


def ingest_delete(jid: str) -> None:
    with db() as conn:
        conn.execute("DELETE FROM ingest_job WHERE id = %s", (jid,))
    ingest_versions_delete(jid)


# ------------------------------------------------------------ 모델 변경 이력

def history_add(model_id: str, entries: list[dict[str, Any]]) -> None:
    with db() as conn:
        conn.execute(
            "INSERT INTO model_history (model_id, at, entries) VALUES (%s, %s, %s)",
            (model_id, time.time(), json.dumps(entries, ensure_ascii=False)))


def history_list(model_id: str, limit: int = 50) -> list[dict[str, Any]]:
    with db() as conn:
        rows = conn.execute(
            "SELECT at, entries FROM model_history WHERE model_id = %s "
            "ORDER BY at DESC LIMIT %s", (model_id, int(limit))).fetchall()
    return [{"at": r["at"], "entries": json.loads(r["entries"])} for r in rows]


# ---------------------------------------------------------------- 폴더

def folders() -> list[dict[str, Any]]:
    with db() as conn:
        return [dict(r) for r in conn.execute(
            "SELECT id, name, grp FROM folders ORDER BY grp, name")]


def folder_get(fid: str) -> dict[str, Any] | None:
    with db() as conn:
        r = conn.execute("SELECT id, name, grp FROM folders WHERE id = %s", (fid,)).fetchone()
        return dict(r) if r else None


def folder_create(fid: str, name: str, grp: str) -> dict[str, Any]:
    with db() as conn:
        conn.execute("INSERT INTO folders (id, name, grp, created_at) VALUES (%s, %s, %s, %s)",
                     (fid, name, grp, time.time()))
    return {"id": fid, "name": name, "grp": grp}


def folder_rename(fid: str, name: str) -> None:
    with db() as conn:
        conn.execute("UPDATE folders SET name = %s WHERE id = %s", (name, fid))


def folder_delete(fid: str) -> None:
    """폴더를 지우고 안에 있던 모델은 폴더 없음 으로 내보낸다. 모델 자체는 그대로다."""
    with db() as conn:
        conn.execute("UPDATE model_folder SET folder_id = NULL WHERE folder_id = %s", (fid,))
        conn.execute("DELETE FROM folders WHERE id = %s", (fid,))


def model_folders() -> dict[str, str | None]:
    with db() as conn:
        return {r["model_id"]: r["folder_id"]
                for r in conn.execute("SELECT model_id, folder_id FROM model_folder")}


def model_folder_set(model_id: str, folder_id: str | None) -> None:
    with db() as conn:
        conn.execute(
            "INSERT INTO model_folder (model_id, folder_id) VALUES (%s, %s) "
            "ON CONFLICT(model_id) DO UPDATE SET folder_id = excluded.folder_id",
            (model_id, folder_id))


# ---------------------------------------------------------------- 품질 규칙 결과

def rule_results_add(rows: list[dict[str, Any]]) -> int:
    """실행에서 읽은 규칙 결과를 쌓는다. 같은 (규칙, 실행) 은 한 번만 남는다.

    조회 경로에서 불리므로 조용히 멱등이어야 한다 — 폴링할 때마다 같은 실행을
    다시 읽지만, 그때 행이 늘거나 시각이 바뀌면 날짜별 집계가 흔들린다.
    """
    if not rows:
        return 0
    with db() as conn:
        # Postgres 문법이다. SQLite 시절의 `INSERT OR IGNORE` · `?` · conn.executemany
        # 가 그대로 남아 있었다. 세 가지 모두 여기서만 어긋나 있었고, 앞의 함수들은
        # 이미 `%s` 와 `ON CONFLICT` 를 쓴다. 이 함수는 조회 경로(snapshot)에서
        # 불리기 때문에, 터지면 홈·품질·파이프라인 흐름이 한꺼번에 500 이 됐다.
        cur = conn.cursor()
        cur.executemany(
            "INSERT INTO rule_result "
            "(rule_uid, run_id, model_id, status, failures, at) "
            "VALUES (%s, %s, %s, %s, %s, %s) "
            "ON CONFLICT (rule_uid, run_id) DO NOTHING",
            [(r["ruleUid"], r["runId"], r.get("modelId") or "", r["status"],
              int(r.get("failures") or 0), float(r["at"])) for r in rows])
        return cur.rowcount or 0


def rule_results_latest() -> dict[str, dict[str, Any]]:
    """규칙별 «가장 최근» 결과. 규칙 하나가 여러 실행에 걸쳐 있어도 마지막 것만."""
    with db() as conn:
        rows = conn.execute(
            "SELECT r.rule_uid, r.status, r.failures, r.at, r.run_id "
            "FROM rule_result r JOIN (SELECT rule_uid, MAX(at) AS m FROM rule_result "
            "                         GROUP BY rule_uid) x "
            "  ON x.rule_uid = r.rule_uid AND x.m = r.at").fetchall()
    return {r["rule_uid"]: {"status": r["status"], "failures": r["failures"],
                            "at": r["at"], "runId": r["run_id"]} for r in rows}


def rule_results_daily(days: int = 7,
                       only: list[str] | None = None) -> list[dict[str, Any]]:
    """날짜별 검증 통과율. 그날 결과가 남은 규칙만 세고, 없는 날은 만들지 않는다.

    0 으로 채우면 «그날 전부 실패» 로 읽힌다 — 실제로는 아무것도 안 돌린 날이다.

    only 를 주면 그 규칙들만 센다. 지금 카탈로그에 있는 규칙 목록을 넘기는 자리다 —
    이력에는 지우거나 이름을 바꾼 옛 규칙도 남아 있어서, 그대로 세면 오늘 점이
    KPI 와 어긋난다(실측: 55개로 세어 87.3%, KPI 는 52개로 92.3%).
    """
    since = time.time() - days * 86400
    with db() as conn:
        # date(at,'unixepoch','localtime') 은 SQLite 문법이라 Postgres 에서는 터진다.
        # 날짜는 서버 로캘이 아니라 KST 로 자른다 — 화면의 다른 날짜와 같은 기준이어야
        # 「어제 통과율」이 어제 화면과 맞는다.
        #
        # **규칙 단위로 센다.** 한 규칙이 하루에 스무 번 돌면 실행 단위로는 그 규칙이
        # 스무 표를 갖는다 — 자주 도는 모델의 규칙이 그날 점수를 좌우한다. KPI 는
        # 규칙 개수 기준이므로, 여기서 실행을 세면 같은 지표의 어제·오늘이 서로
        # 다른 분모로 계산된다. 그래서 규칙마다 그날의 마지막 결과 하나만 쓴다.
        rows = conn.execute(
            "WITH last_of_day AS ("
            "  SELECT rule_uid, status,"
            "         to_char(to_timestamp(at) AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS d,"
            "         ROW_NUMBER() OVER ("
            "           PARTITION BY rule_uid,"
            "             to_char(to_timestamp(at) AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD')"
            "           ORDER BY at DESC) AS rn"
            "  FROM rule_result WHERE at >= %s"
            + ("   AND rule_uid = ANY(%s)" if only is not None else "")
            + ")"
            "SELECT d, SUM(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS passed, "
            "       COUNT(*) AS known "
            "FROM last_of_day WHERE rn = 1 GROUP BY d ORDER BY d",
            ((since, list(only)) if only is not None else (since,))).fetchall()
    return [{"date": r["d"], "passed": int(r["passed"]), "known": int(r["known"]),
             "score": round(int(r["passed"]) / int(r["known"]) * 100, 1) if r["known"] else None}
            for r in rows]


# ---------------------------------------------------------------- DATA MART

def marts() -> set[str]:
    """DATA MART 로 지정된 모델 id 집합.

    manifest 와 조인하지 않는다 — 지워진 모델의 행이 남을 수 있지만, 조회하는
    쪽이 항상 카탈로그와 교차해서 쓰므로 고아 행은 화면에 나오지 않는다.
    """
    with db() as conn:
        return {r["model_id"] for r in conn.execute("SELECT model_id FROM model_mart")}


def mart_set(model_id: str, on: bool) -> None:
    with db() as conn:
        if on:
            conn.execute(
                "INSERT INTO model_mart (model_id, marked_at) VALUES (%s, %s) "
                "ON CONFLICT(model_id) DO NOTHING", (model_id, time.time()))
        else:
            conn.execute("DELETE FROM model_mart WHERE model_id = %s", (model_id,))


def mart_marked_at(model_id: str) -> float | None:
    with db() as conn:
        r = conn.execute("SELECT marked_at FROM model_mart WHERE model_id = %s",
                         (model_id,)).fetchone()
        return r["marked_at"] if r else None


# ---------------------------------------------------------------- 파이프라인

_PIPE_COLS = ("id", "name", "description", "env", "freq", "retry",
              "on_fail", "notify", "targets", "task_mode", "include_seeds",
              "trigger_type", "upstream_pipeline_id",
              "created_at", "updated_at")


def _pipe_row(r: dict[str, Any]) -> dict[str, Any]:
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
            f"SELECT {', '.join(_PIPE_COLS)} FROM pipelines WHERE id = %s", (pid,)).fetchone()
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
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
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
        conn.execute("DELETE FROM run_log WHERE pipeline_id = %s", (pid,))
        conn.execute("DELETE FROM pipelines WHERE id = %s", (pid,))


# ---------------------------------------------------------------- 실행 기록

def run_log_add(dag_run_id: str, pipeline_id: str,
                from_node: str | None) -> None:
    with db() as conn:
        conn.execute(
            "INSERT INTO run_log "
            "(dag_run_id, pipeline_id, from_node, created_at) "
            "VALUES (%s, %s, %s, %s) "
            "ON CONFLICT(dag_run_id) DO UPDATE SET "
            "  pipeline_id=excluded.pipeline_id, from_node=excluded.from_node, "
            "  created_at=excluded.created_at",
            (dag_run_id, pipeline_id, from_node, time.time()))


def run_log_get(dag_run_id: str) -> dict[str, Any] | None:
    with db() as conn:
        r = conn.execute(
            "SELECT dag_run_id, pipeline_id, from_node, created_at "
            "FROM run_log WHERE dag_run_id = %s", (dag_run_id,)).fetchone()
        return dict(r) if r else None


# ---------------------------------------------------------------- 모델 부가 설정

def edge_cfg_all(model_id: str) -> dict[str, dict[str, Any]]:
    with db() as conn:
        return {r["from_id"]: json.loads(r["cfg"]) for r in conn.execute(
            "SELECT from_id, cfg FROM model_edge_cfg WHERE model_id = %s", (model_id,))}


def edge_cfg_set(model_id: str, from_id: str, cfg: dict[str, Any]) -> None:
    with db() as conn:
        conn.execute(
            "INSERT INTO model_edge_cfg (model_id, from_id, cfg) VALUES (%s, %s, %s) "
            "ON CONFLICT(model_id, from_id) DO UPDATE SET cfg = excluded.cfg",
            (model_id, from_id, json.dumps(cfg, ensure_ascii=False)))


def transform_get(model_id: str) -> dict[str, Any] | None:
    with db() as conn:
        r = conn.execute("SELECT cfg FROM model_transform WHERE model_id = %s",
                         (model_id,)).fetchone()
        return json.loads(r["cfg"]) if r else None


def transform_set(model_id: str, cfg: dict[str, Any]) -> None:
    with db() as conn:
        conn.execute(
            "INSERT INTO model_transform (model_id, cfg) VALUES (%s, %s) "
            "ON CONFLICT(model_id) DO UPDATE SET cfg = excluded.cfg",
            (model_id, json.dumps(cfg, ensure_ascii=False)))


# ---------------------------------------------------------------- 분석 데이터셋

def ds_all() -> dict[str, dict[str, Any]]:
    """모델id → {datasetId, phys, syncedAt, state}."""
    with db() as conn:
        return {r["model_id"]: {"datasetId": r["dataset_id"], "phys": r["phys"],
                                "syncedAt": r["synced_at"], "state": r["state"]}
                for r in conn.execute("SELECT * FROM superset_dataset")}


def ds_by_dataset() -> dict[int, str]:
    """데이터셋id → 모델id. 차트·대시보드에서 모델로 거슬러 올라갈 때 쓴다."""
    with db() as conn:
        return {r["dataset_id"]: r["model_id"]
                for r in conn.execute(
                    "SELECT model_id, dataset_id FROM superset_dataset")}


def ds_set(model_id: str, dataset_id: int, phys: str, state: str = "ok") -> None:
    with db() as conn:
        conn.execute(
            "INSERT INTO superset_dataset (model_id, dataset_id, phys, synced_at, state) "
            "VALUES (%s, %s, %s, %s, %s) ON CONFLICT(model_id) DO UPDATE SET "
            "dataset_id = excluded.dataset_id, phys = excluded.phys, "
            "synced_at = excluded.synced_at, state = excluded.state",
            (model_id, int(dataset_id), phys, time.time(), state))


def ds_delete(model_id: str) -> None:
    with db() as conn:
        conn.execute("DELETE FROM superset_dataset WHERE model_id = %s", (model_id,))


# ---------------------------------------------------------------- 설정

def pref_get(key: str, default: str = "") -> str:
    with db() as conn:
        r = conn.execute("SELECT v FROM prefs WHERE k = %s", (key,)).fetchone()
        return r["v"] if r else default


def pref_set(key: str, value: str) -> None:
    with db() as conn:
        conn.execute("INSERT INTO prefs (k, v) VALUES (%s, %s) "
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
                "INSERT INTO graph_layout (model_id, x, y) VALUES (%s, %s, %s) "
                "ON CONFLICT(model_id) DO UPDATE SET x = excluded.x, y = excluded.y",
                (mid, float(p.get("x", 0)), float(p.get("y", 0))))
