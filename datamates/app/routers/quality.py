"""데이터 품질 — 설계서 8.1.

규칙은 dbt 테스트다. 별도 저장소를 두지 않는 이유는 설계서의 단일 리소스 원칙
때문이기도 하고, 실제로 검사를 돌리는 것이 dbt 이기 때문이기도 하다.
메타DB 에 규칙을 따로 두면 화면에는 있는데 실행되지 않는 규칙이 생긴다.
"""

from __future__ import annotations

import io
import csv
from typing import Any, Literal

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .. import audit, dbtproj, manifest, state, warehouse
from ..config import dbt_env
from ..errors import ApiError, not_found

router = APIRouter(prefix="/quality", tags=["quality"])


class RuleIn(BaseModel):
    modelId: str
    type: Literal["notnull", "unique", "accepted", "rel", "range"]
    col: str = ""
    sev: Literal["error", "warn"] = "error"
    active: bool = True
    name: str | None = None
    arguments: dict[str, Any] = Field(default_factory=dict)


class RulePatch(BaseModel):
    sev: Literal["error", "warn"] | None = None
    active: bool | None = None


class ActiveIn(BaseModel):
    active: bool


class RunIn(BaseModel):
    scope: str = "all"          # all | 모델 id | 규칙 id


def _rule_or_404(rule_id: str) -> dict[str, Any]:
    r = next((x for x in state.rules() if x["id"] == rule_id), None)
    if not r:
        raise not_found(rule_id)
    return r


@router.get("/rule-types")
def rule_types() -> dict[str, Any]:
    items = []
    for k, v in state.QTYPES.items():
        spec = dbtproj.TEST_SPEC.get(k)
        items.append({**v, "creatable": spec is not None,
                      "requiredArguments": spec["args"] if spec else []})
    return {"items": items, "total": len(items)}


@router.get("/rules")
def list_rules(q: str | None = None, type: str | None = None,
               modelId: str | None = None) -> dict[str, Any]:
    rs = state.rules()
    if type and type != "전체":
        rs = [r for r in rs if r["type"] == type or state.QTYPES[r["type"]]["label"] == type]
    if modelId:
        rs = [r for r in rs if r["modelId"] == modelId]
    if q:
        needle = q.strip().lower()
        rs = [r for r in rs
              if needle in f"{r['name']} {r['col']} {r['modelId']} {r['cond']}".lower()]
    return {"items": rs, "total": len(rs)}


@router.get("/rules/{rule_id}")
def get_rule(rule_id: str) -> dict[str, Any]:
    return _rule_or_404(rule_id)


@router.post("/rules", status_code=201)
def create_rule(body: RuleIn) -> dict[str, Any]:
    if not manifest.get(body.modelId):
        raise not_found(body.modelId)
    try:
        res = dbtproj.add_test(body.modelId, body.col, body.type, body.sev, body.arguments)
    except KeyError as e:
        raise not_found(str(e)) from e
    except ValueError as e:
        raise ApiError("VALIDATION_FAILED", str(e)) from e

    dbtproj.reparse()
    state.invalidate()

    # dbt 가 확정한 테스트 이름을 찾아 돌려준다 — 화면이 이 id 로 다시 부른다.
    made = [r for r in state.rules()
            if r["modelId"] == body.modelId and r["col"] == body.col
            and r["type"] == body.type]
    audit.record(body.modelId, [{
        "item": "품질 규칙", "change": "추가",
        "after": (made[0].get("cond") if made else body.type)
                 + f" ({'오류' if body.sev == 'error' else '주의'})"}])
    return {**(made[0] if made else {}), "touched": res["touched"]}


@router.put("/rules/{rule_id}")
def update_rule(rule_id: str, body: RulePatch) -> dict[str, Any]:
    r = _rule_or_404(rule_id)
    try:
        dbtproj.update_test(r["modelId"], rule_id, severity=body.sev, active=body.active)
    except KeyError as e:
        raise not_found(rule_id) from e
    except ValueError as e:
        raise ApiError("VALIDATION_FAILED", str(e)) from e
    dbtproj.reparse()
    state.invalidate()
    out = _rule_or_404(rule_id)
    changes = []
    if body.sev is not None and body.sev != r["sev"]:
        changes.append(f"심각도 {r['sev']} → {body.sev}")
    if body.active is not None and body.active != r["active"]:
        changes.append("사용" if body.active else "사용 안 함")
    if changes:
        audit.record(r["modelId"], [{
            "item": "품질 규칙", "change": "수정",
            "before": r.get("cond") or rule_id, "after": ", ".join(changes)}])
    return out


@router.patch("/rules/{rule_id}/active")
def toggle_rule(rule_id: str, body: ActiveIn) -> dict[str, Any]:
    return update_rule(rule_id, RulePatch(active=body.active))


@router.delete("/rules/{rule_id}")
def delete_rule(rule_id: str) -> dict[str, Any]:
    r = _rule_or_404(rule_id)
    try:
        res = dbtproj.remove_test(r["modelId"], rule_id)
    except KeyError as e:
        raise not_found(rule_id) from e
    except ValueError as e:
        raise ApiError("VALIDATION_FAILED", str(e)) from e
    dbtproj.reparse()
    state.invalidate()
    audit.record(r["modelId"], [{
        "item": "품질 규칙", "change": "삭제", "before": r.get("cond") or rule_id}])
    return {"deleted": rule_id, **res}


# ---------------------------------------------------------------- 대시보드

@router.get("/dashboard")
def dashboard() -> dict[str, Any]:
    rs = [r for r in state.rules() if r["active"]]
    known = [r for r in rs if r["status"] != "unknown"]
    passed = sum(1 for r in known if r["status"] == "ok")
    err = sum(1 for r in rs if r["status"] == "err")
    warn = sum(1 for r in rs if r["status"] == "warn")
    affected = sorted({r["modelId"] for r in rs if r["status"] in ("err", "warn")})
    entries = manifest.all_entries()
    return {
        "score": round(passed / len(known) * 100) if known else 100,
        "ruleTotal": len(rs), "passed": passed,
        "errCount": err, "warnCount": warn,
        "notRunCount": len(rs) - len(known),
        "affectedModels": [{"id": m, "name": entries[m]["name"]}
                           for m in affected if m in entries],
    }


@router.get("/trend")
def trend(days: int = Query(7, ge=1, le=90)) -> dict[str, Any]:
    """최근 N일 품질 점수.

    dbt 는 실행별 결과만 남기고 날짜별 집계를 두지 않는다. 여기서는 파이프라인
    실행 이력을 날짜로 묶어 계산한다 — 이력이 없는 날은 항목을 만들지 않는다
    (0점으로 채우면 그날 다 실패했다로 읽힌다).
    """
    from collections import defaultdict
    from datetime import datetime

    from .. import airflow_client as af
    from .. import daggen

    per_day: dict[str, list[bool]] = defaultdict(list)
    for p in state.snapshot()["pipelines"]:
        try:
            runs = af.dag_runs(daggen.dag_id_of(p["id"]), limit=days * 4)
        except af.AirflowError:
            continue
        for r in runs:
            ts = r.get("end_date") or r.get("start_date")
            if not ts:
                continue
            try:
                day = datetime.fromisoformat(ts.replace("Z", "+00:00")).strftime("%m.%d")
            except ValueError:
                continue
            per_day[day].append(r.get("state") == "success")

    items = [{"date": d, "score": round(sum(v) / len(v) * 100)}
             for d, v in sorted(per_day.items())][-days:]
    return {"items": items, "total": len(items)}


@router.get("/by-model")
def by_model() -> dict[str, Any]:
    rs = state.rules()
    entries = manifest.all_entries()
    items = []
    for mid in sorted({r["modelId"] for r in rs}):
        mine = [r for r in rs if r["modelId"] == mid and r["active"]]
        e = entries.get(mid)
        if not e:
            continue
        items.append({
            "modelId": mid, "name": e["name"], "phys": e["phys"],
            "ruleCount": len(mine),
            "passed": sum(1 for r in mine if r["status"] == "ok"),
            "status": state.quality_of(mid, rs),
        })
    return {"items": items, "total": len(items)}


# ---------------------------------------------------------------- 위반

@router.get("/violations")
def violations() -> dict[str, Any]:
    items = [r for r in state.rules() if r["active"] and r["status"] in ("err", "warn")]
    return {"items": items, "total": len(items)}


@router.get("/violations/{rule_id}/rows")
def violation_rows(rule_id: str, limit: int = Query(20, ge=1, le=200)) -> dict[str, Any]:
    """위반한 실제 행.

    dbt 의 store_failures 가 켜진 테스트만 결과 테이블이 남는다. 꺼져 있으면
    조회할 것이 없으므로 그 사실을 그대로 알린다 — 빈 배열을 돌려주면
    위반이 없다로 오해된다.
    """
    r = _rule_or_404(rule_id)
    if r["status"] == "ok":
        return {"columns": [], "rows": [], "total": 0, "message": "통과한 규칙입니다."}

    schema = f"{dbt_env().get('DBT_SCHEMA', 'analytics')}_test_failures"
    try:
        out = warehouse.preview(f"{schema}.{rule_id}", limit)
    except ApiError:
        # store_failures 가 꺼져 있으면 결과 테이블 자체가 없다. 그 사실을 그대로 알린다 —
        # 빈 배열을 돌려주면 «위반이 없다»로 읽힌다.
        return {"columns": [], "rows": [], "total": 0,
                "message": ("이 규칙은 실패 행을 저장하지 않습니다. "
                            "schema.yml 에서 store_failures: true 를 켜고 다시 실행하면 "
                            "여기서 실제 행을 볼 수 있습니다.")}
    return {"columns": out["columns"], "rows": out["rows"], "total": len(out["rows"])}



# ---------------------------------------------------------------- 실행 · 내보내기

@router.post("/runs", status_code=202)
def run_quality(body: RunIn) -> dict[str, Any]:
    """다시 검증 — dbt test 를 직접 돌린다.

    파이프라인 실행과 달리 모델을 다시 만들지 않으므로 Airflow 를 거치지 않는다.
    """
    select = None
    if body.scope and body.scope != "all":
        if manifest.get(body.scope):
            select = body.scope
        else:
            r = _rule_or_404(body.scope)
            select = r["modelId"]

    args = ["test"] + (["--select", select] if select else [])
    out = dbtproj.run_dbt(args, timeout=1800)
    state.invalidate()
    tail = (out.stdout + out.stderr).strip().splitlines()[-1:] or [""]
    return {"ok": out.returncode == 0, "scope": body.scope,
            "message": tail[0][:300] or "검증을 실행했습니다.",
            "output": (out.stdout + out.stderr)[-4000:]}


@router.get("/report:export")
def export_report() -> StreamingResponse:
    rs = state.rules()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["규칙", "대상 모델", "컬럼", "검사 유형", "심각도", "결과", "위반 건수", "검사 방식"])
    for r in rs:
        w.writerow([r["name"], r["modelId"], r["col"],
                    state.QTYPES[r["type"]]["label"], r["sev"], r["status"],
                    r["cnt"], r["cond"]])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue().encode("utf-8-sig")]),   # 엑셀에서 한글이 깨지지 않게 BOM
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="quality-report.csv"'})
