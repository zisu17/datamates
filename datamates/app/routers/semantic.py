"""Semantic Layer API."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from .. import semantic

router = APIRouter(prefix="/semantic", tags=["semantic"])


@router.get("/summary")
def get_summary() -> dict[str, int]:
    return semantic.summary()


@router.get("/models")
def get_models() -> dict[str, Any]:
    items = semantic.model_list()
    return {"items": items, "total": len(items)}


@router.get("/models/{model_id}")
def get_model(model_id: str) -> dict[str, Any]:
    return semantic.model_detail(model_id)


@router.put("/models/{model_id}")
def put_model(model_id: str, body: dict[str, Any]) -> dict[str, Any]:
    return semantic.save_model(model_id, body)


@router.delete("/models/{model_id}")
def delete_model(model_id: str) -> dict[str, Any]:
    return semantic.delete_model(model_id)


@router.get("/metrics")
def get_metrics() -> dict[str, Any]:
    items = semantic.metric_list()
    return {"items": items, "total": len(items)}


@router.post("/metrics", status_code=201)
def post_metric(body: dict[str, Any]) -> dict[str, Any]:
    return semantic.save_metric(body)


@router.patch("/metrics/{metric_id}")
def patch_metric(metric_id: str, body: dict[str, Any]) -> dict[str, Any]:
    return semantic.save_metric(body, metric_id)


@router.delete("/metrics/{metric_id}")
def delete_metric(metric_id: str) -> dict[str, Any]:
    return semantic.delete_metric(metric_id)


@router.get("/glossary")
def get_glossary() -> dict[str, Any]:
    items = semantic.glossary_list()
    return {"items": items, "total": len(items)}


@router.post("/glossary", status_code=201)
def post_glossary(body: dict[str, Any]) -> dict[str, Any]:
    return semantic.save_glossary(body)


@router.patch("/glossary/{glossary_id}")
def patch_glossary(glossary_id: str, body: dict[str, Any]) -> dict[str, Any]:
    return semantic.save_glossary(body, glossary_id)


@router.delete("/glossary/{glossary_id}")
def delete_glossary(glossary_id: str) -> dict[str, Any]:
    return semantic.delete_glossary(glossary_id)


@router.post("/resolve")
def resolve(body: dict[str, Any]) -> dict[str, Any]:
    return semantic.resolve(body)
