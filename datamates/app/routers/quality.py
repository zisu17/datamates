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

from .. import audit, dbtproj, manifest, state, store, warehouse
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
    """품질 KPI. 화면의 숫자는 전부 여기서 나온다 — 화면이 따로 세면 갈라진다.

    **아직 안 돌린 규칙은 분모에서 뺀다.** 대신 «몇 개 중 몇 개를 쟀는지» 를 함께
    내려준다. 빼는 것 자체는 맞다(재지 않은 것을 실패로 칠 수는 없다). 문제는
    그 사실을 감추는 것이었다 — 잰 규칙이 하나도 없을 때 100 을 돌려주는 바람에
    화면에 「검증 통과율 100%」가 떴다. 아는 게 없으면 점수도 없다(None).
    """
    rs = [r for r in state.rules() if r["active"]]
    known = [r for r in rs if r["status"] != "unknown"]
    passed = sum(1 for r in known if r["status"] == "ok")
    err = sum(1 for r in rs if r["status"] == "err")
    warn = sum(1 for r in rs if r["status"] == "warn")
    affected = sorted({r["modelId"] for r in rs if r["status"] in ("err", "warn")})
    entries = manifest.all_entries()
    # 오류 행도 «잰 규칙» 만 센다. 지난 실행의 잔존값을 현재 수치로 내보내면
    # 실패 0건인데 오류 행 7,151 같은 조합이 나온다(실제로 그랬다).
    err_rows = sum(int(r.get("cnt") or 0) for r in known if r["status"] in ("err", "warn"))
    return {
        "score": round(passed / len(known) * 100, 1) if known else None,
        "ruleTotal": len(rs),
        "measured": len(known),          # 결과를 아는 규칙 수 = 점수의 분모
        "passed": passed,
        "errCount": err, "warnCount": warn,
        "errRows": err_rows,
        "errRuleCount": sum(1 for r in known
                            if r["status"] in ("err", "warn") and (r.get("cnt") or 0) > 0),
        "notRunCount": len(rs) - len(known),
        "affectedModels": [{"id": m, "name": entries[m]["name"]}
                           for m in affected if m in entries],
    }


def backfill_rule_results(days: int = 90) -> dict[str, Any]:
    """규칙 결과 이력을 Elementary 에서 한 번 채워 넣는다.

    이력 테이블은 오늘부터 쌓이기 시작하므로, 그대로 두면 추이 그래프에 점이
    하나뿐이다. 그런데 같은 사실이 이미 elementary_test_results 에 실행 단위로
    남아 있다 — 규칙 id·상태·실패 행 수·검사 시각이 전부 있어 그대로 옮길 수 있다.

    (규칙, 실행) 이 기본키라 몇 번 돌려도 안전하다. run_id 는 Elementary 쪽
    실행 시각에서 만든다 — 같은 검사가 같은 시각에 두 번 기록되지 않는다.
    Elementary 가 없거나 저장소가 닫혀 있으면 조용히 건너뛴다.
    """
    from .history import EL, TS, _rows, _since
    try:
        # 별칭을 at 으로 두면 안 된다 — DuckDB 에서 AT 은 예약어(AT TIME ZONE)라
        # 바로 다음의 from 에서 파서가 깨진다.
        rows = _rows(f"""
            select test_unique_id uid, status,
                   coalesce(failures, 0) failures,
                   epoch({TS.format('detected_at')}) ran_at
            from {EL}.elementary_test_results
            where {TS.format('detected_at')} >= {_since(days)}
              and test_unique_id is not null""")
    except Exception as e:      # noqa: BLE001 — 이력이 없어도 서비스는 떠야 한다
        return {"filled": 0, "skipped": str(e)[:200]}

    keep = []
    for r in rows:
        st = (r.get("status") or "").lower()
        keep.append({
            "ruleUid": r["uid"],
            "runId": f"el:{int(float(r['ran_at']))}",
            "status": ("ok" if st in ("pass", "success")
                       else "warn" if st == "warn"
                       else "err" if st in ("fail", "error") else "unknown"),
            "failures": int(r.get("failures") or 0),
            "at": float(r["ran_at"]),
        })
    added = store.rule_results_add(keep)
    return {"read": len(keep), "filled": added}


@router.post("/history:backfill")
def backfill(days: int = Query(90, ge=1, le=365)) -> dict[str, Any]:
    """화면에서 이력을 다시 채우고 싶을 때. 멱등이라 몇 번 눌러도 안전하다."""
    return backfill_rule_results(days)


@router.get("/trend")
def trend(days: int = Query(7, ge=1, le=90)) -> dict[str, Any]:
    """최근 N일 **검증 통과율**.

    예전에는 Airflow dag_run 의 성공 여부를 세었다. 그건 «파이프라인이 끝까지
    돌았나» 이지 «데이터가 규칙을 지켰나» 가 아니다. 제목만 통과율이라 KPI 옆에
    나란히 놓이면 같은 지표의 추이로 읽혔고, 실제로 100% 와 90.4% 가 한 화면에
    함께 떴다.

    지금은 규칙 결과 이력(store.rule_result)을 날짜로 묶는다. 결과가 남지 않은
    날은 항목을 만들지 않는다 — 0 으로 채우면 «그날 전부 실패» 로 읽힌다.
    """
    # 지금 카탈로그에 있는 규칙만 센다 — 그래야 오늘 점이 KPI 와 같은 분모가 된다.
    # (이력에는 지운 규칙도 남아 있어, 그대로 세면 마지막 점만 KPI 와 어긋난다)
    live = [r["uniqueId"] for r in state.rules() if r["active"]]
    items = store.rule_results_daily(days, only=live)
    # 날짜는 YYYY-MM-DD 그대로 둔다 — 화면이 축을 날짜로 계산한다(자르는 것은 화면 몫).
    # passRate 는 /history/tests/daily 와 같은 이름이다. 추이 카드가 두 응답을
    # 같은 코드로 그릴 수 있어야 출처를 바꿔도 그리는 쪽을 고치지 않는다.
    for it in items:
        it["passRate"] = it["score"]
    return {"items": items, "total": len(items),
            "metric": "검증 통과율",
            "note": "그날 마지막으로 검사한 결과를 규칙 단위로 셉니다. "
                    "실행이 없던 날은 표시하지 않습니다."}


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
