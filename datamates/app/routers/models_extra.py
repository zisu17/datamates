"""모델 부가 인터페이스 — 설계서 6.1 잔여 · 6.3.

입력 관계(inputs)와 관계 그래프는 SQL 의 ref() 가 곧 입력이라는 원칙을 따른다.
그래서 연결을 더하거나 지우는 것은 SQL 을 고치는 일이고, 여기서는 관계를 읽어
보여주는 것과 화면이 붙인 주석(역할·설명)을 보관하는 것만 한다.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel

from . import models as models_router
from .. import dbtproj, manifest, sqlcheck, sqlgen, state, store
from ..errors import ApiError, not_found

router = APIRouter(tags=["models"])

EDGE_ROLES = ["기준 데이터", "조인 데이터", "참조 데이터", "일반 입력 데이터"]


class DescIn(BaseModel):
    desc: str


class EdgeCfgIn(BaseModel):
    role: str | None = None
    desc: str | None = None
    op: str | None = None


class LayoutIn(BaseModel):
    positions: dict[str, dict[str, float]]


class TransformIn(BaseModel):
    base: str | None = None
    joins: list[str] = []
    joinType: str = "left join"
    joinOn: str = ""
    cols: list[str] = []
    filter: str = ""
    clean: list[str] = []
    aggFn: str = ""
    aggCol: str = ""
    groupBy: list[str] = []
    useSql: bool = False
    sql: str = ""


class ParseRefsIn(BaseModel):
    sql: str


def _entry(model_id: str) -> dict[str, Any]:
    e = manifest.get(model_id)
    if not e:
        raise not_found(model_id)
    return e


def _columns_of(mid: str) -> list[list[str]]:
    e = manifest.get(mid)
    return e["cols"] if e else []


# ---------------------------------------------------------------- 관계 · 배치
# 주의: /models/graph 는 /models/{model_id} 보다 먼저 등록돼야 한다.
# 그렇지 않으면 "graph" 가 model_id 로 잡힌다. main.py 의 include 순서로 보장한다.

@router.get("/models/graph")
def models_graph() -> dict[str, Any]:
    g = manifest.graph()
    pos = store.layout_get()
    marts = store.marts()
    for n in g["nodes"]:
        p = pos.get(n["id"])
        n["x"], n["y"] = (p["x"], p["y"]) if p else (None, None)
        n["baseGroup"] = n["group"]
        n["isMart"] = n["id"] in marts
        if n["isMart"]:
            n["group"] = "DATA MART"
    return g


@router.put("/models/graph/layout")
def save_layout(body: LayoutIn) -> dict[str, Any]:
    store.layout_set(body.positions)
    return {"saved": len(body.positions)}


@router.post("/sql:parse-refs")
def parse_refs(body: ParseRefsIn) -> dict[str, Any]:
    parsed = sqlcheck.parse_refs(body.sql)
    known = set(manifest.all_entries())
    return {**parsed, "missingRefs": [r for r in parsed["refs"] if r not in known]}


# ---------------------------------------------------------------- 모델 부가

@router.put("/models/{model_id}/description")
def put_description(model_id: str, body: DescIn) -> dict[str, Any]:
    _entry(model_id)
    dbtproj.write_model(model_id, description=body.desc)
    dbtproj.reparse()
    state.invalidate()
    return {"id": model_id, "desc": body.desc}


@router.get("/models/{model_id}/inputs")
def inputs(model_id: str) -> dict[str, Any]:
    e = _entry(model_id)
    cfgs = store.edge_cfg_all(model_id)
    items = []
    for up in e["upstream"]:
        u = manifest.get(up) or {}
        c = cfgs.get(up, {})
        items.append({"fromId": up, "name": u.get("name", up), "phys": u.get("phys"),
                      "group": u.get("group"),
                      "role": c.get("role") or "일반 입력 데이터",
                      "desc": c.get("desc", ""), "cfg": c})
    return {"items": items, "total": len(items), "roles": EDGE_ROLES,
            "note": "입력 관계는 SQL 의 ref() 가 정합니다. 추가·삭제는 SQL 탭에서 하세요."}


@router.post("/models/{model_id}/inputs", status_code=409)
def add_input(model_id: str) -> dict[str, Any]:
    """입력 추가는 곧 SQL 수정이다.

    여기서 몰래 SQL 에 ref() 를 끼워 넣으면 사용자가 쓴 SQL 이 뜻하지 않게 바뀐다.
    그래서 거절하고 무엇을 해야 하는지 알려준다.
    """
    _entry(model_id)
    raise ApiError(
        "GRAPH_SOURCE_INPUT",
        "입력 관계는 SQL 의 ref() 로 정해집니다. SQL 탭에서 ref('모델명') 을 추가하고 저장하세요.",
        {"modelId": model_id}, status=409)


@router.delete("/models/{model_id}/inputs/{from_id}", status_code=409)
def del_input(model_id: str, from_id: str) -> dict[str, Any]:
    _entry(model_id)
    raise ApiError(
        "GRAPH_SOURCE_INPUT",
        "입력 관계는 SQL 의 ref() 로 정해집니다. SQL 탭에서 해당 ref() 를 지우고 저장하세요.",
        {"modelId": model_id, "fromId": from_id}, status=409)


@router.put("/models/{model_id}/inputs/{from_id}/config")
def put_edge_cfg(model_id: str, from_id: str, body: EdgeCfgIn) -> dict[str, Any]:
    e = _entry(model_id)
    if from_id not in e["upstream"]:
        raise not_found(f"{model_id} ← {from_id}")
    cur = store.edge_cfg_all(model_id).get(from_id, {})
    cur.update({k: v for k, v in body.model_dump().items() if v is not None})
    store.edge_cfg_set(model_id, from_id, cur)
    return {"modelId": model_id, "fromId": from_id, "cfg": cur}


@router.get("/models/{model_id}/transform")
def get_transform(model_id: str) -> dict[str, Any]:
    e = _entry(model_id)
    cfg = store.transform_get(model_id)
    if cfg is None:
        cfg = sqlgen.default_cfg(e["upstream"][0] if e["upstream"] else None)
        cfg["joins"] = e["upstream"][1:]
    return {"modelId": model_id, "cfg": cfg,
            "cleanRules": sqlgen.CLEAN_RULES,
            "inputs": e["upstream"]}


@router.post("/models/{model_id}/transform:preview-sql")
def preview_sql(model_id: str, body: TransformIn) -> dict[str, Any]:
    _entry(model_id)
    sql = body.sql if body.useSql else sqlgen.generate(body.model_dump(), _columns_of)
    known = set(manifest.all_entries()) | {model_id}
    return {"sql": sql, "validation": sqlcheck.validate(sql, known)}


@router.put("/models/{model_id}/transform")
def put_transform(model_id: str, body: TransformIn) -> dict[str, Any]:
    """변환 설정을 저장하고 SQL 을 다시 만든다.

    설정과 SQL 이 어긋나면 화면에 보이는 설정과 실제로 도는 SQL이 달라지므로,
    저장은 항상 둘을 함께 갱신한다.
    """
    _entry(model_id)
    cfg = body.model_dump()
    sql = body.sql if body.useSql else sqlgen.generate(cfg, _columns_of)

    known = set(manifest.all_entries()) | {model_id}
    v = sqlcheck.validate(sql, known)
    if not v["ok"]:
        raise ApiError(models_router.sql_error_code(v), v["message"],
                       {"errors": v["errors"]})
    # 마트를 입력으로 부르는 것은 여기서도 막는다 — SQL 을 쓰는 경로가 둘이다.
    models_router._validate_or_400(sql, self_id=model_id)

    store.transform_set(model_id, cfg)
    dbtproj.write_model(model_id, sql=sql)
    dbtproj.reparse()
    state.invalidate()
    return {"modelId": model_id, "cfg": cfg, "sql": sql}


@router.get("/models/{model_id}/pipelines")
def model_pipelines(model_id: str) -> dict[str, Any]:
    _entry(model_id)
    items = [{"pipelineId": p["id"], "name": p["name"], "freq": p["freq"],
              "status": p["status"]}
             for p in state.snapshot()["pipelines"]
             if model_id in p["flow"]["order"]]
    return {"items": items, "total": len(items)}


@router.get("/models/{model_id}/history")
def model_history(model_id: str, limit: int = 20) -> dict[str, Any]:
    """변경 이력 — 저장할 때마다 자동으로 기록된 것을 시간순으로 준다.

    변경사항 기록 버튼(수동 git 커밋)을 없애면서 원천을 메타스토어로
    바꿨다. 신원 기능이 제품에서 빠져 있어 누가는 없다.
    """
    _entry(model_id)
    from datetime import datetime, timezone
    items = [{
        "when": datetime.fromtimestamp(h["at"], tz=timezone.utc).isoformat(),
        "entries": h["entries"],
    } for h in store.history_list(model_id, limit)]
    return {"items": items, "total": len(items),
            "message": None if items else
            "저장할 때마다 변경 이력이 자동으로 기록됩니다. 아직 기록된 변경이 없습니다."}
