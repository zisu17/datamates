"""Semantic Layer 도메인 서비스.

dbt manifest/catalog 의 기술 메타데이터에 Postgres의 비즈니스 정의를 그때그때
합친다. 이 모듈은 물리 테이블·컬럼 타입·dbt 설명을 저장하지 않는다.

Resolver의 출력은 analytics/query.py가 이미 받는 spec이다. 여기서 SQL이나
Superset payload를 새로 만들지 않아 분석 실행 경로가 둘로 갈라지지 않는다.
"""

from __future__ import annotations

import re
from typing import Any
from uuid import uuid4

from . import manifest, store
from .errors import ApiError, not_found

AGGREGATIONS = {"SUM", "AVG", "MIN", "MAX", "COUNT", "COUNT_DISTINCT"}
FORMATS = {"number", "currency", "percent", "decimal", "integer"}
GRANULARITIES = {"day", "week", "month", "quarter", "year"}
LINK_TYPES = {"model", "column", "dimension", "measure", "metric"}
KEY_RE = re.compile(r"^[a-z][a-z0-9_]{1,62}$")


def _columns(entry: dict[str, Any]) -> dict[str, dict[str, str]]:
    desc = entry.get("col_desc") or {}
    return {c[0]: {"name": c[0], "label": c[1] or c[0], "type": c[2] or "",
                   "description": desc.get(c[0], "")} for c in entry.get("cols") or []}


def _mart_entry(model_id: str) -> dict[str, Any]:
    entry = manifest.get(model_id)
    if not entry:
        raise not_found(f"데이터 모델 {model_id}")
    if entry.get("kind") != "model" or model_id not in store.marts():
        raise ApiError(
            "SEMANTIC_MODEL_NOT_MART",
            "Semantic Model은 DATA MART로 지정된 데이터 모델에만 정의할 수 있습니다.",
            {"modelId": model_id}, status=409)
    return entry


def summary() -> dict[str, int]:
    entries = manifest.all_entries()
    marts = {mid for mid in store.marts()
             if mid in entries and entries[mid].get("kind") == "model"}
    defined = store.semantic_model_ids() & marts
    return {"dataMartCount": len(marts), "semanticModelCount": len(defined),
            "metricCount": len(store.metrics()), "glossaryCount": len(store.glossary()),
            "undefinedMartCount": len(marts - defined)}


def model_list() -> list[dict[str, Any]]:
    entries = manifest.all_entries()
    definitions = {m["model_id"]: m for m in store.semantic_models()}
    out = []
    for mid in sorted(store.marts()):
        entry = entries.get(mid)
        if not entry or entry.get("kind") != "model":
            continue
        sm = definitions.get(mid)
        out.append({
            "modelId": mid, "technicalName": entry["name"], "physicalTable": entry["phys"],
            "dbtDescription": entry.get("desc") or "", "defined": bool(sm),
            "businessName": sm["business_name"] if sm else "",
            "description": sm["description"] if sm else "",
            "defaultTimeDimension": sm["default_time_dimension"] if sm else None,
            "columnCount": len(entry.get("cols") or []),
        })
    return out


def _field_view(field: dict[str, Any], cols: dict[str, dict[str, str]]) -> dict[str, Any]:
    col = cols.get(field.get("column_name") or "", {})
    return {"id": field["id"], "kind": field["kind"],
            "column": field.get("column_name"), "columnType": col.get("type", ""),
            "dbtDescription": col.get("description", ""),
            "businessName": field["business_name"],
            "description": field.get("description") or "",
            "dimensionType": field.get("dimension_type") or "general",
            "granularities": field.get("granularities") or [],
            "aggregation": field.get("aggregation"),
            "displayFormat": field.get("display_format") or "number"}


def model_detail(model_id: str) -> dict[str, Any]:
    entry = _mart_entry(model_id)
    cols = _columns(entry)
    sm = store.semantic_model_get(model_id)
    fields = sm.get("fields", []) if sm else []
    grouped = {"entities": [], "dimensions": [], "measures": []}
    names = {"entity": "entities", "dimension": "dimensions", "measure": "measures"}
    for field in fields:
        grouped[names[field["kind"]]].append(_field_view(field, cols))
    return {
        "modelId": model_id, "technicalName": entry["name"],
        "physicalTable": entry["phys"], "dbtDescription": entry.get("desc") or "",
        "tags": entry.get("tags") or [], "defined": bool(sm),
        "businessName": sm["business_name"] if sm else entry["name"],
        "description": sm["description"] if sm else "",
        "defaultTimeDimension": sm["default_time_dimension"] if sm else None,
        "columns": list(cols.values()), **grouped,
    }


def _normalize_fields(model_id: str, body: dict[str, Any],
                      existing: dict[str, Any] | None) -> list[dict[str, Any]]:
    entry = _mart_entry(model_id)
    known = set(_columns(entry))
    old = {f["id"]: f for f in (existing or {}).get("fields", [])}
    seen_ids: set[str] = set()
    seen_defs: set[tuple[str, str | None]] = set()
    out: list[dict[str, Any]] = []
    for plural, kind in (("entities", "entity"), ("dimensions", "dimension"),
                         ("measures", "measure")):
        for raw in body.get(plural) or []:
            given_id = raw.get("id")
            if given_id and given_id not in old:
                raise ApiError("INVALID_ARGUMENT", "다른 Semantic Model의 필드 ID는 사용할 수 없습니다.",
                               {"fieldId": given_id})
            fid = given_id or f"sf_{uuid4().hex}"
            if fid in seen_ids:
                raise ApiError("INVALID_ARGUMENT", "같은 필드가 두 번 포함되어 있습니다.",
                               {"fieldId": fid})
            seen_ids.add(fid)
            col = (raw.get("column") or "").strip() or None
            agg = (raw.get("aggregation") or "").upper() or None
            if not col and not (kind == "measure" and agg == "COUNT"):
                raise ApiError("INVALID_ARGUMENT", f"{kind}의 실제 컬럼을 선택해 주세요.")
            if col and col not in known:
                raise ApiError("SEMANTIC_COLUMN_NOT_FOUND",
                               f"{col} 은(는) {model_id}의 실제 컬럼이 아닙니다.",
                               {"modelId": model_id, "column": col}, status=422)
            marker = (kind, col)
            if marker in seen_defs:
                raise ApiError("INVALID_ARGUMENT", "같은 종류와 컬럼의 필드를 중복 정의할 수 없습니다.",
                               {"kind": kind, "column": col})
            seen_defs.add(marker)
            name = (raw.get("businessName") or "").strip()
            if not name:
                raise ApiError("INVALID_ARGUMENT", "필드의 비즈니스 표시명을 입력해 주세요.")

            dim_type = raw.get("dimensionType") or "general"
            grans = list(dict.fromkeys(raw.get("granularities") or []))
            if kind == "dimension":
                if dim_type not in {"general", "time"}:
                    raise ApiError("INVALID_ARGUMENT", "Dimension 유형이 올바르지 않습니다.")
                if dim_type == "time":
                    bad = [g for g in grans if g not in GRANULARITIES]
                    if bad:
                        raise ApiError("INVALID_ARGUMENT", f"지원하지 않는 시간 단위입니다: {', '.join(bad)}")
                else:
                    grans = []
            else:
                dim_type, grans = "general", []
            if kind == "measure" and agg not in AGGREGATIONS:
                raise ApiError("INVALID_ARGUMENT", f"집계 방식 {agg or '(없음)'} 은 지원하지 않습니다.")
            fmt = raw.get("displayFormat") or "number"
            if fmt not in FORMATS:
                raise ApiError("INVALID_ARGUMENT", f"표시 형식 {fmt} 은 지원하지 않습니다.")
            out.append({"id": fid, "kind": kind, "column_name": col,
                        "business_name": name, "description": (raw.get("description") or "").strip(),
                        "dimension_type": dim_type, "granularities": grans,
                        "aggregation": agg if kind == "measure" else None,
                        "display_format": fmt})
    return out


def save_model(model_id: str, body: dict[str, Any]) -> dict[str, Any]:
    _mart_entry(model_id)
    business_name = (body.get("businessName") or "").strip()
    if not business_name:
        raise ApiError("INVALID_ARGUMENT", "비즈니스 표시명을 입력해 주세요.")
    existing = store.semantic_model_get(model_id)
    fields = _normalize_fields(model_id, body, existing)
    time_cols = {f["column_name"] for f in fields
                 if f["kind"] == "dimension" and f["dimension_type"] == "time"}
    default_time = body.get("defaultTimeDimension") or None
    if default_time and default_time not in time_cols:
        raise ApiError("INVALID_ARGUMENT",
                       "기본 시간 차원은 시간 유형으로 정의한 Dimension 중에서 선택해 주세요.")

    old_measures = {f["id"] for f in (existing or {}).get("fields", [])
                    if f["kind"] == "measure"}
    new_ids = {f["id"] for f in fields}
    removed = list(old_measures - new_ids)
    refs = store.semantic_measure_metric_refs(removed)
    if refs:
        raise ApiError("SEMANTIC_MEASURE_IN_USE",
                       "등록 지표가 참조하는 Measure는 삭제할 수 없습니다. 먼저 지표를 수정하거나 삭제해 주세요.",
                       {"metrics": refs, "measureIds": removed}, status=409)
    store.semantic_model_put(model_id,
                             {"business_name": business_name,
                              "description": (body.get("description") or "").strip(),
                              "default_time_dimension": default_time}, fields)
    return model_detail(model_id)


def delete_model(model_id: str) -> dict[str, Any]:
    if not store.semantic_model_get(model_id):
        raise not_found(f"Semantic Model {model_id}")
    store.semantic_model_delete(model_id)
    return {"deleted": model_id,
            "message": "Semantic Model 정의와 연결된 지표·용어 연결을 정리했습니다."}


def _metric_view(row: dict[str, Any]) -> dict[str, Any]:
    sm = store.semantic_model_get(row["model_id"])
    measure = next((f for f in (sm or {}).get("fields", [])
                    if f["id"] == row["measure_id"]), None)
    entry = manifest.get(row["model_id"]) or {}
    col = (measure or {}).get("column_name")
    agg = (measure or {}).get("aggregation") or ""
    calc = f"{agg}({col or '*'})"
    return {"id": row["id"], "metricKey": row["metric_key"],
            "displayName": row["display_name"], "description": row.get("description") or "",
            "semanticModel": row["model_id"],
            "semanticModelName": (sm or {}).get("business_name") or entry.get("name") or row["model_id"],
            "measureId": row["measure_id"],
            "measureName": (measure or {}).get("business_name") or row["measure_id"],
            "column": col, "aggregation": agg, "calculation": calc,
            "displayFormat": row.get("display_format") or "number",
            "unit": row.get("unit") or ""}


def metric_list() -> list[dict[str, Any]]:
    return [_metric_view(m) for m in store.metrics()]


def save_metric(body: dict[str, Any], metric_id: str | None = None) -> dict[str, Any]:
    old = store.metric_get(metric_id) if metric_id else None
    if metric_id and not old:
        raise not_found(f"지표 {metric_id}")
    values = dict(old or {})
    mapping = {"metricKey": "metric_key", "displayName": "display_name",
               "description": "description", "semanticModel": "model_id",
               "measureId": "measure_id", "displayFormat": "display_format", "unit": "unit"}
    for source, target in mapping.items():
        if source in body and body[source] is not None:
            values[target] = body[source]
    key = (values.get("metric_key") or "").strip()
    if not KEY_RE.fullmatch(key):
        raise ApiError("INVALID_ARGUMENT", "metric key는 영문 소문자로 시작하고 소문자·숫자·밑줄만 사용할 수 있습니다.")
    values["metric_key"] = key
    values["display_name"] = (values.get("display_name") or "").strip()
    if not values["display_name"]:
        raise ApiError("INVALID_ARGUMENT", "지표 표시명을 입력해 주세요.")
    sm = store.semantic_model_get(values.get("model_id") or "")
    if not sm:
        raise ApiError("INVALID_ARGUMENT", "지표의 Semantic Model을 선택해 주세요.")
    measure = next((f for f in sm["fields"]
                    if f["id"] == values.get("measure_id") and f["kind"] == "measure"), None)
    if not measure:
        raise ApiError("INVALID_ARGUMENT", "선택한 Measure가 이 Semantic Model에 없습니다.")
    duplicate = store.metric_by_key(key)
    if duplicate and duplicate["id"] != metric_id:
        raise ApiError("CONFLICT", f"metric key {key} 은(는) 이미 사용 중입니다.", status=409)
    fmt = values.get("display_format") or measure.get("display_format") or "number"
    if fmt not in FORMATS:
        raise ApiError("INVALID_ARGUMENT", f"표시 형식 {fmt} 은 지원하지 않습니다.")
    values["display_format"] = fmt
    made = store.metric_put(metric_id or f"mt_{uuid4().hex}", values)
    return _metric_view(made)


def delete_metric(metric_id: str) -> dict[str, Any]:
    if not store.metric_delete(metric_id):
        raise not_found(f"지표 {metric_id}")
    return {"deleted": metric_id, "message": "지표를 삭제했습니다."}


def _link_label(link: dict[str, str]) -> str:
    typ, target = link["target_type"], link["target_id"]
    if typ == "model":
        return (manifest.get(target) or {}).get("name") or target
    if typ == "column":
        return target
    if typ in {"dimension", "measure"}:
        for sm in store.semantic_models():
            detail = store.semantic_model_get(sm["model_id"])
            field = next((f for f in (detail or {}).get("fields", []) if f["id"] == target), None)
            if field:
                return f"{sm['business_name']} · {field['business_name']}"
    if typ == "metric":
        metric = store.metric_get(target)
        if metric:
            return metric["display_name"]
    return target


def glossary_list() -> list[dict[str, Any]]:
    return [{"id": g["id"], "term": g["term"], "definition": g["definition"],
             "synonyms": g.get("synonyms") or [], "domain": g.get("domain") or "",
             "links": [{"type": l["target_type"], "targetId": l["target_id"],
                        "label": _link_label(l)} for l in g.get("links") or []]}
            for g in store.glossary()]


def _validate_link(link: dict[str, Any]) -> dict[str, str]:
    typ = link.get("type")
    target = link.get("targetId")
    if typ not in LINK_TYPES or not target:
        raise ApiError("INVALID_ARGUMENT", "용어 연결 대상이 올바르지 않습니다.")
    if typ == "model":
        entry = manifest.get(target)
        valid = bool(entry and entry.get("kind") == "model")
    elif typ == "column":
        mid, sep, col = target.partition(".")
        entry = manifest.get(mid)
        valid = bool(sep and entry and col in _columns(entry))
    elif typ in {"dimension", "measure"}:
        valid = any(any(f["id"] == target and f["kind"] == typ
                        for f in (store.semantic_model_get(m["model_id"]) or {}).get("fields", []))
                    for m in store.semantic_models())
    else:
        valid = bool(store.metric_get(target))
    if not valid:
        raise ApiError("INVALID_ARGUMENT", "존재하지 않는 대상에는 비즈니스 용어를 연결할 수 없습니다.",
                       {"type": typ, "targetId": target})
    return {"target_type": typ, "target_id": target}


def save_glossary(body: dict[str, Any], glossary_id: str | None = None) -> dict[str, Any]:
    old = store.glossary_get(glossary_id) if glossary_id else None
    if glossary_id and not old:
        raise not_found(f"비즈니스 용어 {glossary_id}")
    term = (body.get("term", old.get("term") if old else "") or "").strip()
    definition = (body.get("definition", old.get("definition") if old else "") or "").strip()
    if not term or not definition:
        raise ApiError("INVALID_ARGUMENT", "용어명과 정의를 입력해 주세요.")
    duplicate = store.glossary_by_term(term)
    if duplicate and duplicate["id"] != glossary_id:
        raise ApiError("CONFLICT", f"비즈니스 용어 {term} 은(는) 이미 등록되어 있습니다.", status=409)
    synonyms = body.get("synonyms", old.get("synonyms") if old else []) or []
    synonyms = list(dict.fromkeys(s.strip() for s in synonyms if s and s.strip()))
    raw_links = body.get("links")
    if raw_links is None and old:
        raw_links = [{"type": l["target_type"], "targetId": l["target_id"]}
                     for l in old.get("links") or []]
    links = [_validate_link(l) for l in (raw_links or [])]
    made = store.glossary_put(glossary_id or f"gl_{uuid4().hex}",
                              {"term": term, "definition": definition,
                               "synonyms": synonyms,
                               "domain": (body.get("domain", old.get("domain") if old else "") or "").strip()},
                              links)
    return next(g for g in glossary_list() if g["id"] == made["id"])


def delete_glossary(glossary_id: str) -> dict[str, Any]:
    if not store.glossary_delete(glossary_id):
        raise not_found(f"비즈니스 용어 {glossary_id}")
    return {"deleted": glossary_id, "message": "비즈니스 용어를 삭제했습니다."}


def resolve(body: dict[str, Any]) -> dict[str, Any]:
    requested = body.get("semanticModel") or ""
    sm = store.semantic_model_get(requested)
    if not sm:
        matches = [m for m in store.semantic_models() if m["business_name"] == requested]
        if len(matches) == 1:
            sm = store.semantic_model_get(matches[0]["model_id"])
    if not sm:
        raise not_found(f"Semantic Model {requested}")
    model_id = sm["model_id"]
    _mart_entry(model_id)
    dimensions = [f for f in sm["fields"] if f["kind"] == "dimension"]
    resolved_dims = []
    for key in body.get("dimensions") or []:
        found = next((f for f in dimensions
                      if key in {f["id"], f["column_name"], f["business_name"]}), None)
        if not found:
            raise ApiError("SEMANTIC_DIMENSION_NOT_FOUND",
                           f"Dimension {key} 을(를) {sm['business_name']}에서 찾을 수 없습니다.",
                           {"dimension": key, "modelId": model_id}, status=404)
        resolved_dims.append(found["column_name"])
    metric_rows = []
    for key in body.get("metrics") or []:
        metric = store.metric_by_key(key)
        if not metric or metric["model_id"] != model_id:
            raise ApiError("SEMANTIC_METRIC_NOT_FOUND",
                           f"지표 {key} 을(를) {sm['business_name']}에서 찾을 수 없습니다.",
                           {"metric": key, "modelId": model_id}, status=404)
        measure = next(f for f in sm["fields"] if f["id"] == metric["measure_id"])
        metric_rows.append({"col": measure.get("column_name"),
                            "agg": measure["aggregation"],
                            "metricKey": metric["metric_key"],
                            "label": metric["display_name"]})
    return {"modelId": model_id, "dimensions": resolved_dims, "metrics": metric_rows}
