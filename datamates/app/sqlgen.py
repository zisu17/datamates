"""변환 설정 → dbt SQL 생성 — 설계서 6.1 변환 탭.

화면의 폼(기준 데이터 · 조인 · 컬럼 · 필터 · 정제 · 집계)을 SELECT 하나로 옮긴다.
생성 결과는 하나의 SQL로 하나의 모델 규칙을 반드시 만족해야 하므로,
CTE 를 쓰더라도 문장과 출력은 하나로 유지한다.
"""

from __future__ import annotations

from typing import Any

# 화면의 정제 규칙 체크박스 4종
CLEAN_RULES = ["필수값 없는 행 제외", "중복 행 제거", "문자 공백 제거", "코드 대문자 통일"]

AGG_FN = {"count": "count(*)", "sum": "sum", "avg": "avg", "max": "max", "min": "min"}


def default_cfg(base: str | None = None) -> dict[str, Any]:
    return {"base": base, "joins": [], "joinType": "left join", "joinOn": "",
            "cols": [], "filter": "", "clean": [], "aggFn": "", "aggCol": "",
            "groupBy": [], "useSql": False, "sql": ""}


def generate(cfg: dict[str, Any], columns_of) -> str:
    """cfg 로 SQL 을 만든다. columns_of(model_id) 는 [(name, label, type, req), ...] 를 준다."""
    base = cfg.get("base")
    if not base:
        return "-- 기준 데이터를 먼저 고르세요."

    joins: list[str] = [j for j in (cfg.get("joins") or []) if j]
    clean = set(cfg.get("clean") or [])
    upper = "코드 대문자 통일" in clean
    trim = "문자 공백 제거" in clean

    base_cols = [c[0] for c in columns_of(base)]
    picked = [c for c in (cfg.get("cols") or []) if c in base_cols] or base_cols

    def expr(col: str) -> str:
        e = f"a.{col}"
        if trim:
            e = f"trim({e})"
        if upper:
            e = f"upper({e})"
        return f"{e} as {col}" if e != f"a.{col}" else e

    agg = (cfg.get("aggFn") or "").strip()
    group = [c for c in (cfg.get("groupBy") or []) if c in base_cols]

    lines: list[str] = ["select"]
    if agg:
        keys = group or picked[:2]
        sel = [expr(c) for c in keys]
        if agg == "count":
            sel.append("count(*) as row_count")
        else:
            col = cfg.get("aggCol") or (picked[-1] if picked else "1")
            sel.append(f"{AGG_FN.get(agg, agg)}(a.{col}) as {agg}_{col}")
        lines.append(",\n".join("    " + s for s in sel))
    else:
        sel = [expr(c) for c in picked]
        if "중복 행 제거" in clean:
            lines[0] = "select distinct"
        lines.append(",\n".join("    " + s for s in sel))

    lines.append(f"from {{{{ ref('{base}') }}}} as a")

    for i, j in enumerate(joins):
        alias = chr(ord("b") + i)
        on = cfg.get("joinOn") or _guess_on(base, j, columns_of, alias)
        lines.append(f"{cfg.get('joinType') or 'left join'} {{{{ ref('{j}') }}}} as {alias}")
        lines.append(f"    on {on}")

    wheres: list[str] = []
    if cfg.get("filter"):
        wheres.append(f"({cfg['filter']})")
    if "필수값 없는 행 제외" in clean:
        req = [c[0] for c in columns_of(base) if c[3] == "필수"]
        wheres += [f"a.{c} is not null" for c in req]
    if wheres:
        lines.append("where " + "\n  and ".join(wheres))

    if agg:
        keys = group or picked[:2]
        lines.append("group by\n" + ",\n".join(f"    a.{c}" for c in keys))

    return "\n".join(lines) + "\n"


def _guess_on(a: str, b: str, columns_of, alias: str) -> str:
    """공통 컬럼 하나를 찾아 조인 조건 초안을 만든다. 없으면 사람이 채우게 남긴다."""
    ca = {c[0] for c in columns_of(a)}
    for c in columns_of(b):
        if c[0] in ca:
            return f"{alias}.{c[0]} = a.{c[0]}"
    return f"{alias}.<컬럼> = a.<컬럼>"
