"""dbt 프로젝트 파일 조작 — 모델의 실체를 만들고 고치고 지운다.

SSoT 가 dbt 파일이므로 「모델을 저장한다」는 곧 여기서 .sql 과 schema.yml 을
쓰는 일이다. 쓰고 나면 `dbt parse` 로 manifest 를 다시 만들어야 카탈로그·계보가
갱신된다 — 그 호출까지가 한 번의 저장이다.

yml 은 ruamel 로 라운드트립한다. 기존 파일에는 손으로 쓴 주석이 많고,
표준 yaml 로 덤프하면 그게 전부 날아간다.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path
from typing import Any

from ruamel.yaml import YAML

from . import manifest
from .config import (AUTHORED_SUBDIR, DBT_BIN, DBT_DIR, DBT_PROJECT_NAME,
                     MODELS_DIR, TARGET_DIR, dbt_env)

_yaml = YAML()
_yaml.preserve_quotes = True
_yaml.indent(mapping=2, sequence=4, offset=2)
_yaml.width = 4096  # 긴 설명이 제멋대로 접히지 않게 한다

# dbt 모델 이름 규칙. 파일명이 되므로 경로 조작 문자를 절대 허용하지 않는다.
NAME_RE = re.compile(r"^[a-z][a-z0-9_]{1,62}$")


class DbtError(RuntimeError):
    """dbt 명령이 실패했을 때. stdout 을 그대로 담아 화면에 보여준다."""

    def __init__(self, message: str, output: str = "", command: str = ""):
        super().__init__(message)
        self.output = output
        self.command = command


def check_name(name: str) -> None:
    if not NAME_RE.match(name):
        raise ValueError(
            "모델 이름은 영소문자로 시작하고 영소문자·숫자·밑줄만 쓸 수 있습니다 (2~63자).")


# ---------------------------------------------------------------- dbt 실행

def run_dbt(args: list[str], timeout: int = 900) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [str(DBT_BIN), *args],
        cwd=DBT_DIR, env=dbt_env(), capture_output=True, text=True, timeout=timeout,
    )


def reparse() -> None:
    """manifest 를 다시 만든다. 모델 파일을 건드린 뒤에는 반드시 불러야 한다.

    parse 는 웨어하우스에 붙지 않으므로 Spark 세션이 뜨지 않는다(약 5초).
    """
    out = run_dbt(["parse", "--quiet"], timeout=180)
    manifest.invalidate()
    if out.returncode != 0:
        raise DbtError("dbt parse 실패 — SQL 이나 yml 에 문법 오류가 있습니다.",
                       output=(out.stdout + out.stderr)[-4000:], command="dbt parse")


# ---------------------------------------------------------------- 경로 결정

def model_sql_path(model_id: str) -> Path:
    """모델의 .sql 경로. 기존 모델은 manifest 가 알려주고, 새 모델은 규약 위치에 만든다."""
    e = manifest.get(model_id)
    if e and e.get("path"):
        return DBT_DIR / e["path"]
    return MODELS_DIR / AUTHORED_SUBDIR / f"{model_id}.sql"


def _patch_path(model_id: str) -> Path:
    """모델의 속성(yml)이 적힌 파일.

    이미 yml 에 등재돼 있으면 그 파일을 그대로 쓴다(손으로 쓴 주석을 보존하며 수정).
    없으면 .sql 과 같은 디렉터리의 _datamates__models.yml 에 모은다 — API 가 만든 것과
    손으로 쓴 것을 파일 단위로 갈라두면 사고가 나도 범위가 좁다.
    """
    e = manifest.get(model_id)
    if e and e.get("patch_path"):
        # 형식: "analytics://models/staging/_staging__models.yml"
        rel = e["patch_path"].split("://", 1)[-1]
        return DBT_DIR / rel
    return model_sql_path(model_id).parent / "_datamates__models.yml"


def _load_yml(path: Path) -> dict[str, Any]:
    if path.exists():
        data = _yaml.load(path.read_text()) or {}
    else:
        data = {}
    data.setdefault("version", 2)
    data.setdefault("models", [])
    return data


def _dump_yml(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w") as fh:
        _yaml.dump(data, fh)


# ---------------------------------------------------------------- 원천 등록

# 데이터 수집이 만든 raw 테이블을 dbt 에 알리는 파일. 통째로 생성물이라
# 사람이 고치지 않는다 — 수집 작업을 저장할 때마다 다시 쓴다.
SOURCES_PATH = MODELS_DIR / "_ingested__sources.yml"

# raw 테이블이 사는 Iceberg 네임스페이스. 수집 전용이고 dbt 는 읽기만 한다.
SOURCE_SCHEMA = "raw"


def write_sources(tables: list[dict[str, Any]]) -> None:
    """수집 대상 raw 테이블들을 dbt source 로 등록한다.

    source 로 등록해야 모델이 source('raw', 'raw_orders') 로 참조할 수 있고,
    manifest 에 들어가면서 카탈로그·계보 화면에 원천으로 나타난다.
    수집이 만든 테이블만 적는다 — 목록이 비면 파일을 지운다.
    """
    if not tables:
        if SOURCES_PATH.exists():
            SOURCES_PATH.unlink()
        return
    entries = []
    for t in sorted(tables, key=lambda x: x["name"]):
        e: dict[str, Any] = {"name": t["name"]}
        if t.get("description"):
            e["description"] = t["description"]
        cols = [{"name": c["name"]} for c in (t.get("columns") or [])]
        if cols:
            e["columns"] = cols
        entries.append(e)
    _dump_yml(SOURCES_PATH, {
        "version": 2,
        "sources": [{
            "name": SOURCE_SCHEMA,
            "description": "데이터 수집이 적재한 원천 테이블. 이 파일은 자동 생성됩니다.",
            "schema": SOURCE_SCHEMA,
            "tables": entries,
        }],
    })


# ---------------------------------------------------------------- 모델 쓰기

def write_model(model_id: str, *, sql: str | None = None, description: str | None = None,
                materialized: str | None = None, tags: list[str] | None = None,
                columns: list[dict[str, Any]] | None = None,
                create: bool = False) -> dict[str, Any]:
    """모델 파일을 쓴다. None 인 항목은 건드리지 않는다(부분 수정 허용).

    반환값은 실제로 손댄 파일 목록 — 화면의 변경사항 표시와 Git 커밋에 쓴다.
    """
    check_name(model_id)
    existing = manifest.get(model_id)
    if create and existing:
        raise ValueError(f"{model_id} 은(는) 이미 있습니다.")
    if not create and not existing:
        raise KeyError(model_id)
    if existing and existing["kind"] == "source" and sql is not None:
        raise ValueError("SOURCE 는 외부에서 그대로 들어오므로 SQL 을 가질 수 없습니다.")

    touched: list[str] = []

    sql_path = model_sql_path(model_id)
    if sql is not None:
        sql_path.parent.mkdir(parents=True, exist_ok=True)
        body = sql if sql.endswith("\n") else sql + "\n"
        sql_path.write_text(body)
        touched.append(str(sql_path.relative_to(DBT_DIR)))

    if any(v is not None for v in (description, materialized, tags, columns)):
        yml_path = _patch_path(model_id)
        data = _load_yml(yml_path)
        models = data["models"]
        entry = next((m for m in models if m.get("name") == model_id), None)
        if entry is None:
            entry = {"name": model_id}
            models.append(entry)

        if description is not None:
            entry["description"] = description
        if materialized is not None:
            cfg = entry.setdefault("config", {})
            cfg["materialized"] = materialized
        if tags is not None:
            cfg = entry.setdefault("config", {})
            cfg["tags"] = list(tags)
        if columns is not None:
            # 컬럼 설명·표시명만 갱신한다. data_tests 는 품질 규칙 API 의 소관이라
            # 여기서 덮어쓰면 사용자가 만든 검증이 조용히 사라진다.
            by_name = {c.get("name"): c for c in entry.setdefault("columns", [])}
            for col in columns:
                cname = col["name"]
                target = by_name.get(cname)
                if target is None:
                    target = {"name": cname}
                    entry["columns"].append(target)
                    by_name[cname] = target
                if col.get("description") is not None:
                    target["description"] = col["description"]
                if col.get("label") is not None:
                    target.setdefault("meta", {})["label"] = col["label"]

        _dump_yml(yml_path, data)
        touched.append(str(yml_path.relative_to(DBT_DIR)))

    return {"touched": touched}


def delete_model(model_id: str) -> dict[str, Any]:
    """모델의 .sql 과 yml 항목을 지운다.

    하류 모델이 남아 있으면 거부한다 — 지우고 나면 dbt parse 가 없는 ref 로
    깨져서 프로젝트 전체가 파싱 불가가 된다. 화면에서 먼저 막아야 하지만,
    API 단에서도 같은 규칙을 건다.
    """
    e = manifest.get(model_id)
    if not e:
        raise KeyError(model_id)
    if e["kind"] == "source":
        raise ValueError("SOURCE 는 이 API 로 지우지 않습니다. seed/source 정의를 직접 수정하세요.")
    if e["downstream"]:
        raise ValueError(
            f"{model_id} 을(를) 쓰는 모델이 {len(e['downstream'])}개 있습니다: "
            f"{', '.join(e['downstream'])}. 먼저 정리해 주세요.")

    touched: list[str] = []
    sql_path = DBT_DIR / e["path"]
    if sql_path.exists():
        sql_path.unlink()
        touched.append(str(sql_path.relative_to(DBT_DIR)))

    if e.get("patch_path"):
        yml_path = DBT_DIR / e["patch_path"].split("://", 1)[-1]
        if yml_path.exists():
            data = _load_yml(yml_path)
            before = len(data["models"])
            data["models"] = [m for m in data["models"] if m.get("name") != model_id]
            if len(data["models"]) != before:
                _dump_yml(yml_path, data)
                touched.append(str(yml_path.relative_to(DBT_DIR)))

    return {"touched": touched}


# ---------------------------------------------------------------- 품질 규칙(= dbt 테스트)

# 화면의 검사 유형 → dbt 테스트 이름과 필요한 인자.
# fresh(최신성)는 컬럼 테스트가 아니라 source 설정이고, sql(싱귤러)은 tests/*.sql 파일이라
# 여기서 다루지 않는다 — 화면에도 그렇게 알린다.
TEST_SPEC: dict[str, dict[str, Any]] = {
    "notnull": {"dbt": "not_null", "args": []},
    "unique": {"dbt": "unique", "args": []},
    "accepted": {"dbt": "accepted_values", "args": ["values"]},
    "rel": {"dbt": "relationships", "args": ["to", "field"]},
    "range": {"dbt": "dbt_utils.accepted_range", "args": []},
}


def _column_entry(entry: dict[str, Any], col: str) -> dict[str, Any]:
    cols = entry.setdefault("columns", [])
    for c in cols:
        if c.get("name") == col:
            return c
    c = {"name": col}
    cols.append(c)
    return c


def _test_name_of(item: Any) -> str:
    """data_tests 항목의 테스트 이름. 문자열이거나 {이름: 설정} 한 쌍이다."""
    if isinstance(item, str):
        return item
    if isinstance(item, dict) and item:
        return next(iter(item))
    return ""


def add_test(model_id: str, col: str, qtype: str, severity: str,
             kwargs: dict[str, Any] | None = None) -> dict[str, Any]:
    """모델의 컬럼에 검사 규칙을 더한다.

    dbt 는 테스트 이름을 유형_모델_컬럼[_인자] 로 자동 생성하므로 여기서 id 를 정하지
    않는다. 쓰고 나서 dbt parse 를 돌리면 manifest 에 확정된 이름이 나온다.
    """
    spec = TEST_SPEC.get(qtype)
    if not spec:
        raise ValueError(
            f"{qtype} 유형은 아직 화면에서 만들 수 없습니다. "
            "최신성은 source 설정, 사용자 정의 SQL 은 tests/ 폴더의 파일로 관리합니다.")
    e = manifest.get(model_id)
    if not e:
        raise KeyError(model_id)
    if col and not any(c[0] == col for c in e["cols"]):
        raise ValueError(f"{model_id} 에 {col} 컬럼이 없습니다.")

    kwargs = dict(kwargs or {})
    missing = [a for a in spec["args"] if a not in kwargs]
    if missing:
        raise ValueError(f"{qtype} 검사에는 {', '.join(missing)} 값이 필요합니다.")

    yml_path = _patch_path(model_id)
    data = _load_yml(yml_path)
    entry = next((m for m in data["models"] if m.get("name") == model_id), None)
    if entry is None:
        entry = {"name": model_id}
        data["models"].append(entry)

    target = _column_entry(entry, col) if col else entry
    tests = target.setdefault("data_tests", [])
    if any(_test_name_of(t) == spec["dbt"] for t in tests):
        raise ValueError(f"{col or model_id} 에 같은 유형의 검사가 이미 있습니다.")

    node: Any = spec["dbt"]
    body: dict[str, Any] = {}
    if kwargs:
        body["arguments"] = kwargs
    if severity == "warn":
        body["config"] = {"severity": "warn"}
    if body:
        node = {spec["dbt"]: body}
    tests.append(node)

    _dump_yml(yml_path, data)
    return {"touched": [str(yml_path.relative_to(DBT_DIR))],
            "dbt_test": spec["dbt"], "model": model_id, "col": col}


def _find_test(model_id: str, rule_id: str) -> dict[str, Any] | None:
    e = manifest.get(model_id)
    if not e:
        return None
    return next((t for t in e["tests"] if t["name"] == rule_id or t["id"] == rule_id), None)


def update_test(model_id: str, rule_id: str, *, severity: str | None = None,
                active: bool | None = None) -> dict[str, Any]:
    """심각도와 사용 여부만 고친다. 유형·대상 변경은 지우고 다시 만드는 편이 안전하다."""
    t = _find_test(model_id, rule_id)
    if not t:
        raise KeyError(rule_id)
    yml_path = _patch_path(model_id)
    data = _load_yml(yml_path)
    entry = next((m for m in data["models"] if m.get("name") == model_id), None)
    if entry is None:
        raise KeyError(model_id)

    dbt_name = t["type"]
    target = (_column_entry(entry, t["col"]) if t["col"] else entry)
    tests = target.get("data_tests") or []
    for i, item in enumerate(tests):
        if _test_name_of(item) != dbt_name:
            continue
        body = item[dbt_name] if isinstance(item, dict) else {}
        body = dict(body or {})
        cfg = dict(body.get("config") or {})
        if severity is not None:
            if severity == "warn":
                cfg["severity"] = "warn"
            else:
                cfg.pop("severity", None)
        if active is not None:
            # dbt 는 enabled: false 로 테스트를 끈다. 지우지 않고 남겨두는 편이
            # «잠시 꺼둔다»는 화면의 토글 의미에 맞다.
            if active:
                cfg.pop("enabled", None)
            else:
                cfg["enabled"] = False
        if cfg:
            body["config"] = cfg
        else:
            body.pop("config", None)
        tests[i] = {dbt_name: body} if body else dbt_name
        _dump_yml(yml_path, data)
        return {"touched": [str(yml_path.relative_to(DBT_DIR))]}
    raise KeyError(rule_id)


def remove_test(model_id: str, rule_id: str) -> dict[str, Any]:
    t = _find_test(model_id, rule_id)
    if not t:
        raise KeyError(rule_id)
    if t.get("singular"):
        raise ValueError(
            "싱귤러 테스트는 tests/ 폴더의 SQL 파일이라 화면에서 지울 수 없습니다.")
    yml_path = _patch_path(model_id)
    data = _load_yml(yml_path)
    entry = next((m for m in data["models"] if m.get("name") == model_id), None)
    if entry is None:
        raise KeyError(model_id)
    target = (_column_entry(entry, t["col"]) if t["col"] else entry)
    tests = target.get("data_tests") or []
    keep = [x for x in tests if _test_name_of(x) != t["type"]]
    if len(keep) == len(tests):
        raise KeyError(rule_id)
    if keep:
        target["data_tests"] = keep
    else:
        target.pop("data_tests", None)
    _dump_yml(yml_path, data)
    return {"touched": [str(yml_path.relative_to(DBT_DIR))]}


def read_sql(model_id: str) -> str:
    e = manifest.get(model_id)
    if not e:
        raise KeyError(model_id)
    path = DBT_DIR / e["path"]
    return path.read_text() if path.exists() else ""


def compiled_sql(model_id: str) -> str | None:
    """dbt 가 Jinja 를 풀어 실제로 실행한 SQL. run/compile 이후에만 존재한다."""
    e = manifest.get(model_id)
    if not e:
        raise KeyError(model_id)
    path = TARGET_DIR / "compiled" / DBT_PROJECT_NAME / e["path"]
    return path.read_text() if path.exists() else None
