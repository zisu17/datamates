"""카탈로그 · 폴더 — 화면 왼쪽 트리를 그리는 데 필요한 것들."""

from __future__ import annotations

import csv
import io
import time
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .. import airflow_client as af
from .. import daggen, dbtproj, manifest, state, store, warehouse
from ..errors import ApiError

router = APIRouter(tags=["catalog"])


GROUPS = ("SOURCE", "DATA MODEL", "DATA MART")

# 흐름 순서. 카탈로그 목록은 데이터가 지나가는 순서대로 정렬한다.
GROUP_ORDER = {g: i for i, g in enumerate(GROUPS)}


def _item(e: dict[str, Any], folder_id: str | None,
          rs: list[dict[str, Any]] | None = None,
          marts: set[str] | None = None) -> dict[str, Any]:
    is_mart = e["id"] in (marts if marts is not None else store.marts())
    return {
        "id": e["id"], "name": e["name"], "phys": e["phys"],
        # DATA MART 는 별도 객체가 아니라 데이터 모델에 부여된 상태다.
        # 다만 카탈로그에서는 그 상태가 곧 영역이라 group 으로 내보낸다.
        "group": "DATA MART" if is_mart else e["group"],
        "baseGroup": e["group"], "isMart": is_mart,
        "kind": e["kind"], "mat": e["mat"],
        "desc": e["desc"], "tags": e["tags"], "folderId": folder_id,
        # 설계서 5.1 — 카탈로그 자체 속성이 아니라 활성 품질 규칙의 집계 결과다.
        "qualityStatus": state.quality_of(e["id"], rs),
        "testCount": len(e["tests"]),
        "upstreamCount": len(e["upstream"]), "downstreamCount": len(e["downstream"]),
    }


@router.get("/catalog")
def catalog(q: str | None = Query(None, description="이름·경로·설명 부분일치")) -> dict[str, Any]:
    entries = manifest.all_entries()
    placed = store.model_folders()
    marts = store.marts()
    rs = state.rules()
    needle = (q or "").strip().lower()

    items = []
    for e in entries.values():
        if needle and needle not in f"{e['name']} {e['phys']} {e['desc']}".lower():
            continue
        items.append(_item(e, placed.get(e["id"]), rs, marts))
    items.sort(key=lambda x: (GROUP_ORDER.get(x["group"], 9), x["name"]))

    counted = {f["id"]: sum(1 for i in items if i["folderId"] == f["id"])
               for f in store.folders()}
    return {
        "folders": [{**f, "itemCount": counted.get(f["id"], 0)} for f in store.folders()],
        "items": items,
        "total": len(items),
        "counts": {g: sum(1 for i in items if i["group"] == g) for g in GROUPS},
    }


@router.get("/catalog/{model_id}")
def catalog_detail(model_id: str) -> dict[str, Any]:
    e = manifest.get(model_id)
    if not e:
        raise HTTPException(404, f"{model_id} 을(를) 찾을 수 없습니다.")
    placed = store.model_folders().get(model_id)
    lin = manifest.lineage(model_id)
    return {
        **_item(e, placed),
        "path": e["path"], "cols": e["cols"], "col_desc": e["col_desc"],
        "upstream": e["upstream"], "downstream": e["downstream"],
        "lineage": lin, "tests": e["tests"], "file_format": e["file_format"],
    }


@router.get("/catalog/{model_id}/lineage")
def catalog_lineage(model_id: str) -> dict[str, Any]:
    if not manifest.get(model_id):
        raise HTTPException(404, f"{model_id} 을(를) 찾을 수 없습니다.")
    return manifest.lineage(model_id)


@router.get("/catalog/{model_id}/columns")
def catalog_columns(model_id: str) -> dict[str, Any]:
    e = manifest.get(model_id)
    if not e:
        raise HTTPException(404, f"{model_id} 을(를) 찾을 수 없습니다.")
    items = [{"col": c[0], "label": c[1], "type": c[2], "required": c[3] == "필수",
              "desc": e["col_desc"].get(c[0], "")} for c in e["cols"]]
    return {"items": items, "total": len(items)}


def _preview_rows(model_id: str, limit: int) -> dict[str, Any]:
    """웨어하우스에서 상위 N행을 읽는다.

    Spark(dbt show)가 아니라 DuckDB 로 Iceberg 카탈로그에 직접 붙는다.
    같은 조회가 17초 → 0.04초가 된다(warehouse.py 주석의 측정 참고).
    """
    e = manifest.get(model_id)
    if not e:
        raise HTTPException(404, f"{model_id} 을(를) 찾을 수 없습니다.")
    out = warehouse.preview(e["phys"], limit)
    # 컬럼이 하나도 안 잡히면 카탈로그의 정의라도 보여준다(빈 테이블인 경우).
    if not out["columns"]:
        out["columns"] = [c[0] for c in e["cols"]]
    out["totalRows"] = warehouse.count(e["phys"])
    return out


@router.get("/catalog/{model_id}/preview")
def catalog_preview(model_id: str, limit: int = Query(20, ge=1, le=200)) -> dict[str, Any]:
    return _preview_rows(model_id, limit)


@router.get("/catalog/{model_id}/preview:export")
def catalog_preview_export(model_id: str,
                           limit: int = Query(1000, ge=1, le=10000)) -> StreamingResponse:
    data = _preview_rows(model_id, limit)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(data["columns"])
    w.writerows(data["rows"])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue().encode("utf-8-sig")]), media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{model_id}.csv"'})


@router.get("/catalog/{model_id}/usage")
def catalog_usage(model_id: str) -> dict[str, Any]:
    """사용 이력.

    조회 로그를 수집하는 장치가 아직 없다. 확실히 아는 것 — 이 모델을 실행한
    파이프라인 이력 — 만 돌려주고, 사람의 조회 이력은 비워 둔다.
    지어내서 채우면 화면이 없는 사실을 보여주게 된다.
    """
    e = manifest.get(model_id)
    if not e:
        raise HTTPException(404, f"{model_id} 을(를) 찾을 수 없습니다.")
    items = []
    for p in state.snapshot()["pipelines"]:
        if model_id not in p["flow"]["order"]:
            continue
        lr = p["latestRun"] or {}
        items.append({"source": p["name"], "kind": "파이프라인 실행",
                      "time": lr.get("endedAt")})
    return {"items": items, "total": len(items),
            "message": "조회 이력은 수집하지 않습니다. 파이프라인 실행 기록만 표시합니다."}


@router.post("/catalog/{model_id}:load")
def load_seed(model_id: str) -> dict[str, Any]:
    """원천 CSV(dbt seed)를 지금 적재한다.

    파이프라인은 기본적으로 seed 를 돌리지 않는다(레포 안 파일이라 사람이 고칠 때만
    바뀌는데, 매 실행마다 적재하면 Spark 세션 기동 비용만 늘어난다).
    CSV 를 고쳤을 때 이걸로 한 번 올린다.
    """
    e = manifest.get(model_id)
    if not e:
        raise HTTPException(404, f"{model_id} 을(를) 찾을 수 없습니다.")
    if e["dbt_type"] != "seed":
        raise ApiError(
            "INVALID_ARGUMENT",
            f"{e['name']} 은(는) 원천 CSV 가 아닙니다. "
            + ("데이터 모델은 파이프라인에서 실행합니다."
               if e["kind"] == "model" else "외부 테이블은 적재 시스템이 채웁니다."))

    out = dbtproj.run_dbt(["seed", "--select", model_id], timeout=1800)
    state.invalidate()
    # 데이터 이벤트 트리거가 이 원천을 감시하고 있으면 여기서 깨운다.
    if out.returncode == 0:
        try:
            af.asset_event(daggen.model_asset_uri(model_id))
        except af.AirflowError:
            pass    # Airflow 가 없어도 적재 자체는 유효하다
    tail = [ln for ln in (out.stdout + out.stderr).splitlines() if "Done." in ln]
    if out.returncode != 0:
        raise ApiError("UPSTREAM_UNAVAILABLE",
                       f"{e['name']} 적재에 실패했습니다.",
                       {"output": (out.stdout + out.stderr)[-1500:]}, status=503)
    return {"id": model_id, "ok": True,
            "message": f"{e['name']} 을(를) 다시 적재했습니다.",
            "detail": tail[-1] if tail else ""}


@router.get("/graph")
def graph() -> dict[str, Any]:
    """전체 참조 관계 — 관계(ERD) 화면이 그대로 그린다.

    카드 위치는 모델 정의가 아니라 보기 상태라 메타스토어에 둔다.
    """
    g = manifest.graph()
    pos = store.layout_get()
    marts = store.marts()
    for n in g["nodes"]:
        p = pos.get(n["id"])
        if p:
            n.update(x=p["x"], y=p["y"])
        n["baseGroup"] = n["group"]
        n["isMart"] = n["id"] in marts
        if n["isMart"]:
            n["group"] = "DATA MART"
    return g


# ---------------------------------------------------------------- 폴더

class FolderIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    grp: Literal["SOURCE", "DATA MODEL"]


class FolderPatch(BaseModel):
    name: str = Field(min_length=1, max_length=60)


class MoveIn(BaseModel):
    folder_id: str | None = None


@router.get("/folders")
def folders() -> list[dict[str, Any]]:
    return store.folders()


@router.post("/folders", status_code=201)
def folder_create(body: FolderIn) -> dict[str, Any]:
    fid = f"fd{int(time.time() * 1000)}"
    return store.folder_create(fid, body.name.strip(), body.grp)


@router.patch("/folders/{folder_id}")
def folder_rename(folder_id: str, body: FolderPatch) -> dict[str, Any]:
    if not store.folder_get(folder_id):
        raise HTTPException(404, "폴더를 찾을 수 없습니다.")
    store.folder_rename(folder_id, body.name.strip())
    return store.folder_get(folder_id)  # type: ignore[return-value]


@router.delete("/folders/{folder_id}")
def folder_delete(folder_id: str) -> dict[str, Any]:
    if not store.folder_get(folder_id):
        raise HTTPException(404, "폴더를 찾을 수 없습니다.")
    moved = sum(1 for v in store.model_folders().values() if v == folder_id)
    store.folder_delete(folder_id)
    # 폴더만 사라지고 데이터는 그대로다 — 화면에 그렇게 안내한다.
    return {"deleted": folder_id, "moved_to_root": moved}


@router.patch("/catalog/{model_id}/folder")
def model_move(model_id: str, body: MoveIn) -> dict[str, Any]:
    e = manifest.get(model_id)
    if not e:
        raise HTTPException(404, f"{model_id} 을(를) 찾을 수 없습니다.")
    if body.folder_id:
        f = store.folder_get(body.folder_id)
        if not f:
            raise HTTPException(404, "폴더를 찾을 수 없습니다.")
        # SOURCE 폴더에 DATA MODEL 을 넣으면 트리가 뒤섞인다. 화면에서도 막지만 여기서도 막는다.
        if f["grp"] != e["group"]:
            raise HTTPException(
                400, f"{f['name']} 은(는) {f['grp']} 폴더입니다. {e['group']} 은(는) 넣을 수 없습니다.")
    store.model_folder_set(model_id, body.folder_id)
    return {"id": model_id, "folderId": body.folder_id}
