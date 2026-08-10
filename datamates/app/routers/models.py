"""데이터 모델 정의 — dbt 프로젝트 파일을 직접 쓴다.

저장 = .sql / schema.yml 쓰기 + dbt parse. parse 까지 끝나야 카탈로그와 계보가
새 상태를 반영하므로, 응답을 돌려주기 전에 동기로 돌린다(약 5초).
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .. import audit, dbtproj, manifest, sqlcheck, state
from ..errors import ApiError

router = APIRouter(prefix="/models", tags=["models"])


class ColumnIn(BaseModel):
    name: str
    description: str | None = None
    label: str | None = None


class ModelCreate(BaseModel):
    id: str = Field(description="모델 이름. 그대로 파일명·테이블명이 된다.")
    sql: str
    description: str | None = None
    materialized: str | None = Field(None, pattern="^(table|view|incremental|ephemeral)$")
    tags: list[str] | None = None
    columns: list[ColumnIn] | None = None


class ModelPatch(BaseModel):
    sql: str | None = None
    description: str | None = None
    materialized: str | None = Field(None, pattern="^(table|view|incremental|ephemeral)$")
    tags: list[str] | None = None
    columns: list[ColumnIn] | None = None


class SqlIn(BaseModel):
    sql: str


def _known_ids() -> set[str]:
    return set(manifest.all_entries())


def sql_error_code(result: dict[str, Any]) -> str:
    """검증 결과 → 설계서 2.4 의 도메인 오류 코드.

    화면이 코드로 분기할 수 있어야 참조가 없다와 문장이 두 개다를 다르게 안내한다.
    """
    if result.get("stmts", 1) > 1:
        return "SQL_MULTI_STATEMENT"
    if result.get("ddl"):
        return "SQL_DDL_NOT_ALLOWED"
    if result.get("missing_refs"):
        return "SQL_UNKNOWN_REF"
    if not result.get("selects"):
        return "SQL_NO_SELECT"
    return "VALIDATION_FAILED"


def _validate_or_400(sql: str, self_id: str | None = None) -> dict[str, Any]:
    known = _known_ids()
    if self_id:
        known.add(self_id)      # 자기 자신을 참조하는 incremental 패턴을 막지 않는다
    result = sqlcheck.validate(sql, known)
    if not result["ok"]:
        raise ApiError(sql_error_code(result), result["message"],
                       {"errors": result["errors"], "statements": result["stmts"],
                        "cte": result["cte"], "ddl": result["ddl"],
                        "missingRefs": result["missing_refs"]})
    return result


@router.post("/validate")
def validate(body: SqlIn) -> dict[str, Any]:
    """저장 전에 화면이 즉시 부르는 검사. dbt 를 돌리지 않아 즉답한다."""
    return sqlcheck.validate(body.sql, _known_ids())


@router.get("/{model_id}")
def get_model(model_id: str) -> dict[str, Any]:
    e = manifest.get(model_id)
    if not e:
        raise HTTPException(404, f"{model_id} 을(를) 찾을 수 없습니다.")
    return {
        "id": e["id"], "name": e["name"], "phys": e["phys"], "group": e["group"],
        "kind": e["kind"], "desc": e["desc"], "mat": e["mat"],
        "file_format": e["file_format"], "tags": e["tags"], "path": e["path"],
        "cols": e["cols"], "col_desc": e["col_desc"], "tests": e["tests"],
        "upstream": e["upstream"], "downstream": e["downstream"],
        "sql": dbtproj.read_sql(model_id) if e["kind"] == "model" else None,
    }


@router.get("/{model_id}/sql")
def get_sql(model_id: str) -> dict[str, Any]:
    e = manifest.get(model_id)
    if not e:
        raise HTTPException(404, f"{model_id} 을(를) 찾을 수 없습니다.")
    if e["kind"] == "source":
        raise HTTPException(400, "SOURCE 는 SQL 없이 그대로 들어옵니다.")
    return {"id": model_id, "sql": dbtproj.read_sql(model_id),
            "compiled": dbtproj.compiled_sql(model_id)}


@router.post("", status_code=201)
def create_model(body: ModelCreate) -> dict[str, Any]:
    try:
        dbtproj.check_name(body.id)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    if manifest.get(body.id):
        raise HTTPException(409, f"{body.id} 은(는) 이미 있습니다.")
    _validate_or_400(body.sql, self_id=body.id)

    res = dbtproj.write_model(
        body.id, sql=body.sql, description=body.description,
        materialized=body.materialized, tags=body.tags,
        columns=[c.model_dump() for c in body.columns] if body.columns else None,
        create=True)
    _reparse_or_rollback(body.id, res, created=True)
    made = manifest.get(body.id) or {}
    audit.record(body.id, [
        {"item": "모델 생성", "after": body.description or ""},
        {"item": "입력 관계(ref)",
         "after": " · ".join(made.get("upstream") or []) or "없음"},
    ])
    return {"id": body.id, **res, "model": get_model(body.id)}


@router.patch("/{model_id}")
def patch_model(model_id: str, body: ModelPatch) -> dict[str, Any]:
    e = manifest.get(model_id)
    if not e:
        raise HTTPException(404, f"{model_id} 을(를) 찾을 수 없습니다.")
    if body.sql is not None:
        _validate_or_400(body.sql, self_id=model_id)

    before = dbtproj.read_sql(model_id) if e["kind"] == "model" else None
    before_desc, before_up, before_mat = e["desc"], list(e["upstream"]), e["mat"]
    try:
        res = dbtproj.write_model(
            model_id, sql=body.sql, description=body.description,
            materialized=body.materialized, tags=body.tags,
            columns=[c.model_dump() for c in body.columns] if body.columns else None)
    except ValueError as err:
        raise HTTPException(400, str(err)) from err

    _reparse_or_rollback(model_id, res, created=False, previous_sql=before)

    # 저장 = 이력. 무엇이 바뀌었는지는 여기서 가장 정확히 안다.
    after = manifest.get(model_id) or {}
    entries: list[dict[str, Any]] = []
    if body.sql is not None and body.sql != before:
        entries.append({"item": "SQL", "diff": audit.sql_diff(before, body.sql)})
        if sorted(after.get("upstream") or []) != sorted(before_up):
            entries.append({"item": "입력 관계(ref)",
                            "before": " · ".join(before_up) or "없음",
                            "after": " · ".join(after.get("upstream") or []) or "없음"})
    if body.description is not None and body.description != before_desc:
        entries.append({"item": "설명", "before": before_desc, "after": body.description})
    if body.materialized is not None and body.materialized != before_mat:
        entries.append({"item": "생성 방식", "before": before_mat, "after": body.materialized})
    if body.columns is not None:
        entries.append({"item": "컬럼 정의", "after": f"{len(body.columns)}개 항목 갱신"})
    if body.tags is not None:
        entries.append({"item": "태그", "after": ", ".join(body.tags) or "없음"})
    audit.record(model_id, entries)
    return {"id": model_id, **res, "model": get_model(model_id)}


@router.delete("/{model_id}")
def delete_model(model_id: str) -> dict[str, Any]:
    used = [p["name"] for p in state.snapshot()["pipelines"]
            if model_id in p["flow"]["order"]]
    if used:
        raise ApiError("MODEL_IN_USE",
                       f"{model_id} 은(는) 파이프라인 {', '.join(used)} 이(가) 사용 중입니다. "
                       "먼저 실행 대상에서 빼 주세요.", {"pipelines": used})
    try:
        res = dbtproj.delete_model(model_id)
    except KeyError:
        raise HTTPException(404, f"{model_id} 을(를) 찾을 수 없습니다.") from None
    except ValueError as err:
        raise ApiError("MODEL_IN_USE", str(err)) from err

    dbtproj.reparse()
    state.invalidate()
    return {"deleted": model_id, **res}


def _reparse_or_rollback(model_id: str, res: dict[str, Any], *, created: bool,
                         previous_sql: str | None = None) -> None:
    """parse 가 깨지면 방금 쓴 것을 되돌린다.

    되돌리지 않으면 프로젝트 전체가 파싱 불가 상태로 남아 카탈로그까지 못 읽는다.
    한 사람의 잘못된 저장이 플랫폼 전체를 멈추게 두지 않는다.
    """
    try:
        dbtproj.reparse()
        state.invalidate()
    except dbtproj.DbtError as err:
        try:
            if created:
                path = dbtproj.model_sql_path(model_id)
                if path.exists():
                    path.unlink()
            elif previous_sql is not None:
                dbtproj.model_sql_path(model_id).write_text(previous_sql)
            dbtproj.reparse()
        except Exception:       # noqa: BLE001 — 되돌리기 실패는 원래 오류를 가리면 안 된다
            pass
        raise HTTPException(400, {
            "message": "dbt parse 가 실패해 저장을 되돌렸습니다.",
            "output": err.output,
        }) from err
