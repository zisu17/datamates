"""데이터 수집 API — 바깥 데이터를 raw 로 들이는 작업의 등록·실행.

화면 흐름이 그대로 API 흐름이다.
  1) 미리보기(/ingest/preview) — 저장 없이 표본을 읽어 컬럼을 확인한다
  2) 저장(/ingest/jobs)        — 대상 테이블·적재 방식·일정을 확정하고
                                 dbt source 등록 + 수집 DAG 생성까지 한다
  3) 실행(/runs, /execute)     — 수동 실행은 DAG 을 깨우고, DAG 은 다시
                                 /execute 를 불러 적재를 시킨다

한 raw 테이블의 적재는 수집 작업 하나만 맡는다. 파이프라인의 «한 모델의 적재는
파이프라인 하나»와 같은 규칙이다 — 둘이 같은 테이블에 쓰면 어느 쪽이 지금 값을
만들었는지 아무도 모른다.
"""

from __future__ import annotations

import threading
import time
from datetime import datetime
from typing import Any, Literal

from fastapi import APIRouter, Body, UploadFile
from pydantic import BaseModel, Field

from .. import airflow_client as af
from .. import daggen, ingest, ingestdag, manifest, state, store
from ..errors import ApiError, not_found

router = APIRouter(tags=["ingest"])

# 업로드 파일 크기 상한. 이보다 크면 한 번에 메모리로 올리는 방식이 맞지 않는다.
MAX_UPLOAD = 32 * 1024 * 1024


def _decode(raw: bytes) -> str:
    """업로드 파일을 텍스트로. 한국어 CSV 는 CP949 인 경우가 흔하다."""
    for enc in ("utf-8-sig", "utf-8", "cp949"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    raise ApiError("INVALID_ARGUMENT",
                   "파일 인코딩을 읽지 못했습니다. UTF-8 로 저장해 다시 올려 주세요.")


class PreviewIn(BaseModel):
    kind: Literal["api", "file"] = "api"
    config: dict[str, Any] = Field(default_factory=dict)
    text: str | None = None
    # 수정 화면의 미리보기. 비밀 값은 마스킹되어 내려갔으므로 화면이 되돌려주는
    # 설정만으로는 원천에 못 붙는다. 저장된 값을 채워 넣을 작업을 가리킨다.
    job_id: str | None = None


class JobIn(BaseModel):
    name: str = ""
    kind: Literal["api", "file"] = "api"
    target: str = ""
    mode: Literal["append", "overwrite"] = "append"
    config: dict[str, Any] | None = None
    columns: list[dict[str, str]] | None = None
    freq: str | None = None
    retry: int | None = None
    trigger_type: Literal["schedule", "manual"] | None = None
    # 수집 범위. 워터마크는 여기 없다 — 실행이 남기는 값이라 화면이 보내지 않는다.
    scope: dict[str, Any] | None = None


def _target_conflict(target: str, job_id: str | None) -> None:
    """대상이 겹치는지, 이미 다른 것이 쓰는 이름인지 본다."""
    ingest.check_table_name(target)

    owner = store.ingest_by_target(target)
    if owner and owner["id"] != job_id:
        raise ApiError("CONFLICT",
                       f"{ingest.RAW_SCHEMA}.{target} 은(는) 수집 작업 {owner['name']} 이(가) "
                       f"이미 적재하고 있습니다. "
                       f"한 테이블의 적재는 수집 작업 하나만 맡습니다.",
                       status=409)

    # 같은 이름의 모델·원천이 이미 카탈로그에 있으면 화면에서 구분되지 않는다.
    entry = manifest.all_entries().get(target)
    if entry and entry.get("dbt_type") != "source":
        raise ApiError("CONFLICT",
                       f"{target} 은(는) 이미 데이터 모델 이름으로 쓰고 있습니다. "
                       f"다른 이름을 지어 주세요.", status=409)


def _users_block(target: str, verb: str) -> None:
    """이 원천을 참조하는 모델이 있으면 막는다.

    원천 등록이 사라지면 그걸 쓰는 모델이 파싱 단계에서 통째로 깨진다.
    dbt 오류 문구로 알게 두지 않고, 무엇이 걸려 있는지 이름으로 알려준다.
    """
    entry = manifest.all_entries().get(target) or {}
    users = list(entry.get("downstream") or [])
    if users:
        raise ApiError("MODEL_IN_USE",
                       f"{', '.join(users[:5])} 이(가) {ingest.RAW_SCHEMA}.{target} 을(를) "
                       f"쓰고 있어 {verb} 수 없습니다. 모델에서 먼저 참조를 끊어 주세요.")


def _secret_names(cfg: dict[str, Any]) -> set[str]:
    return {str(x) for x in (cfg.get("secret_params") or [])}


def _mask(job: dict[str, Any]) -> dict[str, Any]:
    """비밀로 표시한 값을 응답에서 지운다.

    저장은 그대로 두고 내보낼 때만 비운다. 인증키를 주소에 박으면 목록 응답과
    상세 화면에 그대로 실려 나가는데, 그것을 막으려고 파라미터로 옮긴 것이므로
    여기서 새면 옮긴 의미가 없다. 수정 화면은 빈 값을 «저장됨» 으로 보여 주고,
    비운 채로 저장하면 _keep_secrets 가 기존 값을 되살린다.
    """
    cfg = job.get("config") or {}
    names = _secret_names(cfg)
    auth = cfg.get("auth") or {}
    if not names and not auth:
        return job
    c = dict(cfg)
    if names and c.get("params"):
        c["params"] = {k: ("" if k in names else v) for k, v in c["params"].items()}
    if auth:
        a = dict(auth)
        for f in ("token", "value"):
            if a.get(f):
                a[f] = ""
        c["auth"] = a
    return {**job, "config": c}


def _keep_secrets(new: dict[str, Any] | None,
                  old: dict[str, Any] | None) -> dict[str, Any] | None:
    """비어 온 비밀 값을 기존 값으로 되돌린다.

    화면은 마스킹된(빈) 값을 그대로 돌려보낸다. 이것이 없으면 이름 한 글자만
    고쳐 저장해도 인증키가 지워진다.
    """
    if not new or not old:
        return new
    c = dict(new)
    names = _secret_names(c) | _secret_names(old)
    op = old.get("params") or {}
    if names and c.get("params"):
        c["params"] = {k: (op.get(k, "") if (k in names and not v) else v)
                       for k, v in c["params"].items()}
    oa = old.get("auth") or {}
    if c.get("auth") and oa:
        a = dict(c["auth"])
        for f in ("token", "value"):
            if not a.get(f) and oa.get(f):
                a[f] = oa[f]
        c["auth"] = a
    return c


def _elapsed(start: str | None, end: str | None) -> float | None:
    """실행에 걸린 초. 아직 끝나지 않았으면 None 이다."""
    if not start or not end:
        return None
    try:
        a = datetime.fromisoformat(start.replace("Z", "+00:00"))
        b = datetime.fromisoformat(end.replace("Z", "+00:00"))
    except ValueError:
        return None
    return round((b - a).total_seconds(), 1)


def _run_view(r: dict[str, Any]) -> dict[str, Any]:
    """실행 한 건을 화면 모양으로.

    걸린 시간을 여기서 계산해 내려보낸다 — 화면마다 따로 재면 같은 실행이
    목록과 상세에서 다르게 보인다.
    """
    start, end = r.get("start_date"), r.get("end_date")
    return {"runId": r.get("dag_run_id"), "state": r.get("state"),
            "start": start, "end": end, "type": r.get("run_type"),
            "seconds": _elapsed(start, end)}


def _view(job: dict[str, Any]) -> dict[str, Any]:
    """화면이 쓰는 모양. 예약 상태·다음 실행·최근 실행은 Airflow 가 원천이다."""
    out = dict(_mask(job))
    out["phys"] = f"{ingest.RAW_SCHEMA}.{job['target']}"
    out["dagId"] = ingestdag.dag_id_of(job["id"])
    out["paused"] = None
    out["nextRun"] = None
    out["lastRun"] = None
    if job["kind"] == "api":
        try:
            dag = af.dag_get(out["dagId"])
        except af.AirflowError:
            dag = None
        if dag:
            out["paused"] = bool(dag.get("is_paused"))
            out["nextRun"] = dag.get("next_dagrun_run_after")
        # 목록에서 바로 성공·실패를 보려면 최근 실행 한 건이 필요하다. 화면이
        # 작업마다 따로 물으면 목록을 그릴 때 왕복이 개수만큼 늘어난다.
        try:
            runs = af.dag_runs(out["dagId"], limit=1)
        except af.AirflowError:
            runs = []
        if runs:
            out["lastRun"] = _run_view(runs[0])
    return out


# ---------------------------------------------------------------- 미리보기

@router.post("/ingest/preview")
def preview(body: PreviewIn) -> dict[str, Any]:
    """표본을 읽어 컬럼과 값 몇 줄을 보여준다. 저장도 적재도 하지 않는다.

    컬럼 타입은 전부 문자열이다. 수집은 원본을 그대로 넣는 일이고, 타입을
    정하는 것은 dbt 모델의 판단이다.
    """
    cfg = body.config
    if body.job_id:
        saved = store.ingest_get(body.job_id)
        if saved:
            cfg = _keep_secrets(cfg, saved.get("config")) or cfg
    rows = ingest.sample(body.kind, cfg, body.text)
    return {"columns": ingest.infer_columns(rows), "rows": rows[:20],
            "sampled": len(rows)}


@router.post("/ingest/preview/file")
async def preview_file(file: UploadFile,
                       format: str = "csv", delimiter: str = ",") -> dict[str, Any]:
    """올린 파일의 표본. 파일은 저장하지 않는다."""
    raw = await file.read(MAX_UPLOAD + 1)
    if len(raw) > MAX_UPLOAD:
        raise ApiError("INVALID_ARGUMENT",
                       f"파일이 너무 큽니다 ({MAX_UPLOAD // 1024 // 1024}MB 까지). "
                       f"나눠서 올리거나 API 수집을 써 주세요.")
    rows = ingest.parse_file(_decode(raw), {"format": format, "delimiter": delimiter})
    return {"columns": ingest.infer_columns(rows), "rows": rows[:20],
            "sampled": len(rows), "filename": file.filename}


# ---------------------------------------------------------------- 작업 CRUD

@router.get("/ingest/jobs")
def list_jobs() -> dict[str, Any]:
    return {"items": [_view(j) for j in store.ingest_jobs()]}


@router.get("/ingest/jobs/{job_id}")
def get_job(job_id: str) -> dict[str, Any]:
    job = store.ingest_get(job_id)
    if not job:
        raise not_found("수집 작업")
    return _view(job)


@router.post("/ingest/jobs")
def create_job(body: JobIn) -> dict[str, Any]:
    if not (body.name or "").strip():
        raise ApiError("INVALID_ARGUMENT", "수집 작업 이름을 입력해 주세요.")
    _target_conflict(body.target, None)
    if not body.columns:
        raise ApiError("INVALID_ARGUMENT",
                       "적재할 컬럼이 없습니다. 미리보기로 데이터를 먼저 확인해 주세요.")

    jid = f"ing{int(time.time() * 1000)}"
    return _view(_save({"id": jid, **body.model_dump(exclude_none=True)},
                       store.ingest_jobs()))


@router.patch("/ingest/jobs/{job_id}")
def update_job(job_id: str, body: JobIn) -> dict[str, Any]:
    job = store.ingest_get(job_id)
    if not job:
        raise not_found("수집 작업")

    fields = body.model_dump(exclude_none=True)
    if "config" in fields:
        fields["config"] = _keep_secrets(fields["config"], job.get("config"))
    target = fields.get("target") or job["target"]
    if target != job["target"]:
        _target_conflict(target, job_id)
        # 이름을 옮기면 옛 원천 등록이 사라진다. 그걸 참조하는 모델이 있으면
        # 통째로 파싱이 깨지므로 먼저 막는다 — dbt 오류로 알게 하지 않는다.
        _users_block(job["target"], "옮길")
        # 예전 테이블은 그대로 남긴다. 이미 그 위에 무엇이 서 있을지 모르고,
        # 삭제는 되돌릴 수 없다.

    merged = {**job, **fields, "id": job_id}
    others = [j for j in store.ingest_jobs() if j["id"] != job_id]
    return _view(_save(merged, others))


@router.delete("/ingest/jobs/{job_id}")
def delete_job(job_id: str) -> dict[str, Any]:
    job = store.ingest_get(job_id)
    if not job:
        raise not_found("수집 작업")

    # 이 원천을 쓰는 모델이 있으면 막는다. source 등록이 사라지면 그 모델들이
    # 통째로 파싱 실패한다.
    _users_block(job["target"], "지울")

    # dbt 쪽 반영이 먼저다. 여기서 실패하면 작업은 그대로 남아야 한다 —
    # 메타스토어를 먼저 지우면 되돌릴 수 없는 쪽만 사라진다.
    ingest.sync_sources([j for j in store.ingest_jobs() if j["id"] != job_id])
    store.ingest_delete(job_id)
    ingestdag.remove(job_id)
    try:
        af.dag_delete(ingestdag.dag_id_of(job_id))
    except af.AirflowError:
        pass                      # DAG 이 아직 등록 전이면 지울 것도 없다
    state.invalidate()
    return {"ok": True, "note": f"{ingest.RAW_SCHEMA}.{job['target']} 테이블은 남아 있습니다."}


def _save(job: dict[str, Any], others: list[dict[str, Any]]) -> dict[str, Any]:
    """dbt 반영이 성공했을 때만 저장한다.

    순서가 중요하다. 원천 등록이 실패하는 경우(참조가 끊기는 이름 변경 등)에
    메타스토어를 먼저 고쳐 두면, 화면은 새 값을 보여주는데 dbt 는 옛 값을
    아는 상태가 된다. 되돌릴 수 있는 쪽(파일)을 먼저 시험하고, 되돌릴 수
    없는 쪽(저장)을 마지막에 한다.

    DAG 은 API 수집만 만든다. 파일 수집은 파일이 도착하는 순간이 곧 실행
    시점이라 예약이라는 개념이 없다 — 올릴 때 그 자리에서 적재한다.
    """
    ingest.sync_sources(others + [job])
    saved = store.ingest_upsert(job["id"], job)
    if saved["kind"] == "api":
        ingestdag.write(saved)
        _autostart(saved)
    else:
        ingestdag.remove(saved["id"])
    state.invalidate()
    return saved


def _autostart(job: dict[str, Any]) -> None:
    """예약 수집은 저장하자마자 깨운다.

    Airflow 는 새 DAG 을 정지 상태로 만든다(dags_are_paused_at_creation=True).
    그대로 두면 「매시 정각」으로 저장해도 정각이 와서 아무 일이 없다 — 화면은
    예약이라고 적어 두고 실제로는 멈춰 있는 상태다.

    수동 실행은 건드리지 않는다. 그건 「지금 실행」이 누를 때 깨운다.
    이미 있는 작업을 수정할 때 사용자가 일부러 멈춰 둔 것을 되살리지 않도록,
    **아직 Airflow 가 모르는 새 DAG 일 때만** 깨운다.

    **응답을 붙잡지 않는다.** DAG 프로세서가 파일을 읽는 데 15초쯤 걸리는데
    그동안 저장 버튼이 멈춰 있으면 안 된다. 뒤에서 기다렸다 켠다.
    """
    if (job.get("trigger_type") or "manual") != "schedule":
        return
    dag_id = ingestdag.dag_id_of(job["id"])
    try:
        if af.dag_get(dag_id):
            return                    # 이미 아는 DAG — 일시정지 상태는 사용자 것이다
    except af.AirflowError:
        return

    def run() -> None:
        for _ in range(30):           # DAG 프로세서가 파일을 읽을 때까지 (최대 30초)
            time.sleep(1)
            try:
                if af.dag_get(dag_id):
                    af.dag_unpause(dag_id)
                    return
            except af.AirflowError:
                return

    threading.Thread(target=run, daemon=True).start()


# ---------------------------------------------------------------- 실행

@router.post("/ingest/jobs/{job_id}/runs")
def trigger_run(job_id: str) -> dict[str, Any]:
    """수동 실행 — DAG 을 깨운다. 실제 적재는 DAG 이 /execute 로 시킨다."""
    job = store.ingest_get(job_id)
    if not job:
        raise not_found("수집 작업")
    if job["kind"] != "api":
        raise ApiError("INVALID_ARGUMENT",
                       "파일 수집은 파일을 올릴 때 적재합니다. 파일 올리기를 써 주세요.")

    dag_id = ingestdag.dag_id_of(job_id)
    try:
        af.dag_unpause(dag_id)
        run = af.trigger(dag_id)
    except af.AirflowError as e:
        raise ApiError("UPSTREAM_UNAVAILABLE",
                       f"수집 실행을 시작하지 못했습니다. {e}", status=503) from e
    return {"runId": run.get("dag_run_id"), "dagId": dag_id}


@router.get("/ingest/jobs/{job_id}/runs")
def list_runs(job_id: str, limit: int = 20) -> dict[str, Any]:
    job = store.ingest_get(job_id)
    if not job:
        raise not_found("수집 작업")
    try:
        runs = af.dag_runs(ingestdag.dag_id_of(job_id), limit=limit)
    except af.AirflowError:
        runs = []
    return {"items": [_run_view(r) for r in runs]}


@router.get("/ingest/jobs/{job_id}/runs/{run_id}/log")
def run_log(job_id: str, run_id: str, try_number: int = 1) -> dict[str, Any]:
    """실행 한 건의 로그. Airflow 태스크 로그를 그대로 돌려준다.

    수집 DAG 은 태스크가 하나(적재 호출)뿐이라 어느 태스크인지 고를 필요가 없다.
    적재는 API 가 하므로 이 로그에 «적재 결과» 줄과 실패 사유가 함께 남는다.
    """
    job = store.ingest_get(job_id)
    if not job:
        raise not_found("수집 작업")
    if job["kind"] != "api":
        raise ApiError("INVALID_ARGUMENT", "파일 수집은 예약 실행 로그가 없습니다.")
    try:
        text = af.task_log(ingestdag.dag_id_of(job_id), run_id,
                           ingestdag.task_id_of(job["target"]), try_number)
    except af.AirflowError as e:
        raise ApiError("UPSTREAM_UNAVAILABLE",
                       f"로그를 가져오지 못했습니다: {e}", status=503) from e
    return {"runId": run_id, "try_number": try_number, "log": text}


@router.post("/ingest/jobs/{job_id}/execute")
def execute(job_id: str) -> dict[str, Any]:
    """실제 적재. 수집 DAG 이 부른다 — 화면이 직접 부르지는 않는다.

    적재 엔진(pyiceberg)이 이 프로세스에만 있어서 실행이 여기서 일어난다.
    Airflow 는 언제 돌릴지와 겹치지 않게 잡아두는 일, 그리고 끝났다는
    Asset 이벤트를 내는 일을 맡는다.
    """
    job = store.ingest_get(job_id)
    if not job:
        raise not_found("수집 작업")
    if job["kind"] != "api":
        raise ApiError("INVALID_ARGUMENT", "파일 수집은 예약 실행 대상이 아닙니다.")

    started = time.time()
    result = ingest.run_job(job)
    result["elapsed"] = round(time.time() - started, 2)
    return result


@router.post("/ingest/jobs/{job_id}/upload")
async def upload(job_id: str, file: UploadFile) -> dict[str, Any]:
    """파일 수집 실행 — 올린 파일을 그 자리에서 적재한다.

    파일 도착은 예약이 아니라 사건이라 DAG 을 거치지 않는다. 대신 적재가
    끝나면 Asset 이벤트를 직접 낸다 — 원천 CSV 다시 적재와 같은 방식이다.
    """
    job = store.ingest_get(job_id)
    if not job:
        raise not_found("수집 작업")
    if job["kind"] != "file":
        raise ApiError("INVALID_ARGUMENT", "이 작업은 API 수집입니다. 지금 실행을 써 주세요.")

    raw = await file.read(MAX_UPLOAD + 1)
    if len(raw) > MAX_UPLOAD:
        raise ApiError("INVALID_ARGUMENT",
                       f"파일이 너무 큽니다 ({MAX_UPLOAD // 1024 // 1024}MB 까지).")

    started = time.time()
    result = ingest.run_job(job, text=_decode(raw))
    result["elapsed"] = round(time.time() - started, 2)
    result["filename"] = file.filename

    if result["rows"]:
        try:
            result["notified"] = af.asset_event(daggen.model_asset_uri(job["target"]))
        except af.AirflowError:
            result["notified"] = False
    state.invalidate()
    return result


# ---------------------------------------------------------------- 예약 켜고 끄기

@router.patch("/ingest/jobs/{job_id}/paused")
def set_paused(job_id: str, paused: bool = Body(embed=True)) -> dict[str, Any]:
    job = store.ingest_get(job_id)
    if not job:
        raise not_found("수집 작업")
    try:
        dag = af.dag_set_paused(ingestdag.dag_id_of(job_id), paused)
    except af.AirflowError as e:
        raise ApiError("UPSTREAM_UNAVAILABLE",
                       f"예약 상태를 바꾸지 못했습니다. {e}", status=503) from e
    return {"paused": bool(dag.get("is_paused"))}
