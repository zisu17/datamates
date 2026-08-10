"""데이터 계보 — 모델 단위(manifest) + 컬럼 단위(SQL AST 분석)를 한 번에 준다."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter

from .. import collineage

router = APIRouter(tags=["lineage"])


@router.get("/lineage")
def full_lineage() -> dict[str, Any]:
    """관계 화면이 그대로 그리는 전체 계보.

    · nodes        — 카탈로그 전체. 컬럼마다 tx(변환 여부)·status(ok/unknown)
    · modelEdges   — 모델 단위 참조 (dbt manifest 그대로)
    · columnEdges  — 컬럼 단위 흐름 (SQL AST 에서 추출, N:1 지원)
    · transforms   — 모델id.컬럼 → { sql: 변환식, inputs: 입력 컬럼들 }

    파싱하지 못한 모델은 lineageStatus=unknown + 사유가 붙는다.
    추측으로 채운 간선은 없다.
    """
    return collineage.compute()
