"""분석 스펙 → Superset payload.

**Explore 를 복제하지 않는다.** Superset 의 옵션은 수백 개지만 사용자가 이해해야 하는
흐름은 하나다.

    데이터 선택 → 시각화 선택 → 차원·측정값 설정 → 결과 확인 → 저장

그 흐름에 필요한 것만 스펙으로 받고, Superset 이 요구하는 형태로 여기서 번역한다.
화면은 Superset 의 어휘(datasource · groupby · adhoc_filters · viz_type)를 모른다 —
모델·차원·측정값·필터만 안다.

스펙 (화면이 보내는 것):

    {"modelId": "agg_daily_events",
     "viz": "bar",                                   # table|bar|line|pie|kpi
     "dimensions": ["event_type"],
     "metrics": [{"col": "total_amount", "agg": "SUM"}],
     "filters": [{"col": "event_type", "op": "==", "val": "purchase"}],
     "limit": 100}

번역은 두 방향이 필요하다.
  · data_payload  — 미리보기·실행용 (/api/v1/chart/data). 시각화 종류와 무관하게
                    같은 모양이다. 결과 표는 어느 차트든 같은 데이터에서 나온다.
  · chart_params  — 저장용 (/api/v1/chart/). 여기만 시각화별로 갈린다.
"""

from __future__ import annotations

from typing import Any

from .. import manifest, store
from ..errors import ApiError

# 지원 시각화. 늘리지 않는다 — 흐름을 이해시키는 것이 목적이고,
# 옵션이 늘면 그 흐름이 보이지 않는다.
VIZ = {
    "table": {"label": "표",     "superset": "table",
              "dims": (0, 8), "metrics": (0, 8)},
    "bar":   {"label": "막대",   "superset": "echarts_timeseries_bar",
              "dims": (1, 2), "metrics": (1, 4)},
    "line":  {"label": "선",     "superset": "echarts_timeseries_line",
              "dims": (1, 2), "metrics": (1, 4)},
    "pie":   {"label": "원",     "superset": "pie",
              "dims": (1, 1), "metrics": (1, 1)},
    "kpi":   {"label": "숫자",   "superset": "big_number_total",
              "dims": (0, 0), "metrics": (1, 1)},
}

# 집계 함수. Superset 이 SIMPLE 측정값으로 받는 것 중 설명이 필요 없는 것만.
#
# MEDIAN 은 Superset 의 SIMPLE 집계 목록에 없어서 SQL 식으로 내보낸다(_metric 참고).
# 그래도 넣는 이유는, 평균만 있으면 **틀린 답을 주기 때문이다.** 가격·소득·체류시간
# 처럼 오른쪽 꼬리가 긴 분포에서 평균은 소수의 큰 값에 끌려간다. 실거래가로 보면
# 강남구 한 달 매매가의 평균과 중위가 억 단위로 갈린다. 시각화 종류를 늘리지 않는
# 것과 달리, 이것은 «다른 화면» 이 아니라 «맞는 값» 의 문제다.
AGG = {"SUM": "합계", "AVG": "평균", "MEDIAN": "중위값", "MIN": "최소", "MAX": "최대",
       "COUNT": "건수", "COUNT_DISTINCT": "고유 개수"}

# SIMPLE 측정값으로 보낼 수 없어 SQL 식으로 내보내는 집계.
SQL_AGG = {"MEDIAN": "median({col})"}

# 필터 연산자. 화면에 그대로 나가는 라벨을 함께 둔다.
OPS = {"==": "같음", "!=": "다름", ">": "초과", ">=": "이상",
       "<": "미만", "<=": "이하", "LIKE": "포함", "IS NOT NULL": "값 있음",
       "IS NULL": "값 없음"}
NO_VALUE_OPS = {"IS NOT NULL", "IS NULL"}


def _entry(model_id: str) -> dict[str, Any]:
    e = manifest.all_entries().get(model_id)
    if not e:
        raise ApiError("NOT_FOUND", f"데이터 모델 {model_id} 을 찾을 수 없습니다.",
                       status=404)
    return e


def dataset_id(model_id: str) -> int:
    row = store.ds_all().get(model_id)
    if not row:
        raise ApiError(
            "INVALID_ARGUMENT",
            "이 데이터 모델은 아직 분석에서 쓸 수 없습니다. "
            "데이터 분석 화면의 「데이터 모델 동기화」를 먼저 실행해 주세요.",
            {"modelId": model_id})
    return int(row["datasetId"])


def label_of(model_id: str, col: str) -> str:
    """컬럼의 표시 이름. dbt meta.label 이 있으면 그것, 없으면 컬럼명."""
    for c in _entry(model_id).get("cols") or []:
        if c[0] == col:
            return c[1] or col
    return col


def known_columns(model_id: str) -> dict[str, str]:
    """실제 존재하는 컬럼 → 타입. **Superset 데이터셋이 기준이다.**

    manifest 의 `cols` 를 기준으로 쓰면 안 된다 — 거기에는 dbt schema.yml 에
    **문서화된 컬럼만** 들어 있다. fct_events 는 테이블에 9개인데 manifest 에는 6개다.
    그 상태로 검증하면 event_ts 같은 실재 컬럼을 「이 모델의 컬럼이 아니다」 로
    거부한다 — 사용자는 눈에 보이는 컬럼을 못 쓰게 되고 이유를 알 수 없다.

    데이터셋은 reflection으로 채워져 있어 Superset이 질의할 때 쓰는 컬럼 목록과 같다.
    """
    from . import client
    try:
        d = client.api("GET", f"/api/v1/dataset/{dataset_id(model_id)}")["result"]
        return {c["column_name"]: (c.get("type") or "")
                for c in d.get("columns") or []}
    except ApiError:
        raise
    except Exception:      # noqa: BLE001 — 조회 실패 시 검증을 건너뛴다.
        return {}          # Superset 이 어차피 거부하고 그 메시지가 올라온다.


def _metric(model_id: str, m: dict[str, Any]) -> dict[str, Any]:
    col, agg = m.get("col"), (m.get("agg") or "SUM").upper()
    if agg not in AGG:
        raise ApiError("INVALID_ARGUMENT", f"집계 함수 {agg} 는 지원하지 않습니다.")
    # COUNT 는 컬럼이 없어도 된다 — 행 수를 센다.
    if agg == "COUNT" and not col:
        return {"expressionType": "SQL", "sqlExpression": "COUNT(*)",
                "label": "건수", "hasCustomLabel": True}
    if not col:
        raise ApiError("INVALID_ARGUMENT", "측정값의 컬럼을 골라 주세요.")
    if agg in SQL_AGG:
        # Superset 이 SIMPLE 로 받아 주지 않는 집계다. 식으로 내보내면 엔진(DuckDB)이
        # 그대로 실행한다 — 컬럼 이름은 따옴표로 감싸 예약어와 부딪히지 않게 한다.
        return {"expressionType": "SQL",
                "sqlExpression": SQL_AGG[agg].format(col=f'"{col}"'),
                "label": _metric_label(label_of(model_id, col), agg),
                "hasCustomLabel": True}
    return {"expressionType": "SIMPLE",
            "column": {"column_name": col},
            "aggregate": agg,
            "label": _metric_label(label_of(model_id, col), agg),
            "hasCustomLabel": True}


def _metric_label(col_label: str, agg: str) -> str:
    """「금액 합계」에 SUM 을 걸면 「금액 합계 합계」가 되면 안 된다.

    dbt meta.label 이 이미 집계를 담고 있는 경우가 흔하다(금액 합계 · 사용자 수 ·
    이벤트 건수). 라벨이 그 집계어로 끝나면 덧붙이지 않는다.
    """
    word = AGG[agg]
    return col_label if col_label.endswith(word) else f"{col_label} {word}"


def _filters(spec: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for f in spec.get("filters") or []:
        col, op = f.get("col"), (f.get("op") or "==").upper()
        if not col:
            continue
        if op not in OPS:
            raise ApiError("INVALID_ARGUMENT", f"필터 연산자 {op} 는 지원하지 않습니다.")
        item: dict[str, Any] = {"col": col, "op": op}
        if op not in NO_VALUE_OPS:
            v = f.get("val")
            if v is None or v == "":
                raise ApiError("INVALID_ARGUMENT",
                               f"필터 「{col}」 의 값을 입력해 주세요.")
            item["val"] = v
        out.append(item)
    return out


def validate(spec: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    """스펙을 검사하고 (시각화 키, 모델 엔트리)를 준다.

    화면도 같은 규칙으로 막지만 서버가 독립적으로 다시 본다 —
    오류 문장은 서버가 한국어 완성문으로 만든다(errors.py 규약).
    """
    viz = (spec.get("viz") or "table").lower()
    if viz not in VIZ:
        raise ApiError("INVALID_ARGUMENT", f"차트 종류 {viz} 는 지원하지 않습니다.")
    e = _entry(spec.get("modelId") or "")

    names = set(known_columns(e["id"]))
    dims = [d for d in (spec.get("dimensions") or []) if d]
    mets = spec.get("metrics") or []

    for d in dims:
        if names and d not in names:
            raise ApiError("INVALID_ARGUMENT", f"{d} 는 이 모델의 컬럼이 아닙니다.")
    for m in mets:
        c = m.get("col")
        if c and names and c not in names:
            raise ApiError("INVALID_ARGUMENT", f"{c} 는 이 모델의 컬럼이 아닙니다.")

    rule = VIZ[viz]
    lo, hi = rule["dims"]
    if not (lo <= len(dims) <= hi):
        what = {"bar": "막대", "line": "선", "pie": "원", "kpi": "숫자",
                "table": "표"}[viz]
        raise ApiError("INVALID_ARGUMENT",
                       f"{what} 차트의 차원은 {lo}~{hi}개여야 합니다. "
                       f"현재 {len(dims)}개입니다.")
    lo, hi = rule["metrics"]
    if not (lo <= len(mets) <= hi):
        raise ApiError("INVALID_ARGUMENT",
                       f"측정값은 {lo}~{hi}개여야 합니다. 현재 {len(mets)}개입니다.")
    return viz, e


def data_payload(spec: dict[str, Any]) -> dict[str, Any]:
    """미리보기·실행용. 시각화 종류와 무관하게 같은 모양이다."""
    viz, e = validate(spec)
    mid = e["id"]
    dims = [d for d in (spec.get("dimensions") or []) if d]
    mets = [_metric(mid, m) for m in (spec.get("metrics") or [])]
    limit = min(int(spec.get("limit") or 100), 1000)

    q: dict[str, Any] = {
        "columns": dims,
        "metrics": mets,
        "filters": _filters(spec),
        "row_limit": limit,
        "is_timeseries": False,
    }
    # 측정값이 있으면 그 첫 번째로 내림차순 — 「많은 것부터」가 기본 기대다.
    if mets:
        q["orderby"] = [[mets[0], False]]
    # 측정값이 없는 표는 원시 행 조회다. columns 를 그대로 뽑는다.
    if viz == "table" and not mets:
        q["metrics"] = []
        q["orderby"] = []

    return {"datasource": {"id": dataset_id(mid), "type": "table"},
            "queries": [q], "result_format": "json", "result_type": "results"}


def chart_params(spec: dict[str, Any], name: str) -> dict[str, Any]:
    """저장용 params. 여기만 시각화별로 갈린다."""
    viz, e = validate(spec)
    mid = e["id"]
    dims = [d for d in (spec.get("dimensions") or []) if d]
    mets = [_metric(mid, m) for m in (spec.get("metrics") or [])]
    limit = min(int(spec.get("limit") or 100), 1000)
    # 저장 시에는 adhoc_filters 형태로 넣어야 Superset 화면이 읽는다.
    adhoc = [{"expressionType": "SIMPLE", "subject": f["col"],
              "operator": f["op"], "comparator": f.get("val"),
              "clause": "WHERE"} for f in _filters(spec)]

    base: dict[str, Any] = {"viz_type": VIZ[viz]["superset"],
                            "row_limit": limit, "adhoc_filters": adhoc}

    if viz == "table":
        base.update({"query_mode": "aggregate" if mets else "raw",
                     "groupby": dims, "metrics": mets,
                     "all_columns": [] if mets else dims})
    elif viz in ("bar", "line"):
        # 첫 차원이 X축, 나머지는 계열 분리.
        # 범례는 차트 «하단 중앙» 이다 — CSS 로 옮기지 않고 차트 설정으로 정한다.
        base.update({"x_axis": dims[0], "groupby": dims[1:], "metrics": mets,
                     "x_axis_sort_asc": True,
                     "show_legend": True, "legendOrientation": "bottom",
                     "legendType": "scroll"})
    elif viz == "pie":
        base.update({"groupby": dims, "metric": mets[0],
                     "show_legend": True, "legendOrientation": "bottom",
                     "donut": True, "show_labels": False})
    elif viz == "kpi":
        base.update({"metric": mets[0]})

    base["slice_name"] = name
    return base


def query_context_from_params(params: dict[str, Any],
                              dataset_id_: int) -> dict[str, Any]:
    """저장된 차트의 params → 질의 맥락. **스펙을 거치지 않는다.**

    플랫폼이 만든 차트는 저장할 때 맥락을 함께 넣지만, 사람이 Superset 에서
    직접 만든 차트에는 없다. 그런 차트도 플랫폼이 그려야 하므로 params 를
    그대로 번역한다 — 측정값은 손대지 않고 통째로 넘긴다(SQL 측정값·계산 필드가
    섞여 있어서, 우리 스펙 모양으로 되돌리려 하면 그때부터 못 그리는 차트가 생긴다).
    """
    dims = ([params["x_axis"]] if params.get("x_axis") else []) \
        + list(params.get("groupby") or [])
    mets = list(params.get("metrics") or [])
    if not mets and params.get("metric"):
        mets = [params["metric"]]
    if not dims and not mets:
        dims = list(params.get("all_columns") or [])

    q: dict[str, Any] = {
        "columns": dims,
        "metrics": mets,
        "filters": [{"col": f.get("subject"), "op": f.get("operator"),
                     **({"val": f["comparator"]} if f.get("comparator") is not None else {})}
                    for f in (params.get("adhoc_filters") or [])
                    if f.get("subject") and f.get("operator")],
        "row_limit": int(params.get("row_limit") or 100),
        "is_timeseries": False,
    }
    if mets:
        q["orderby"] = [[mets[0], False]]
    return {"datasource": {"id": int(dataset_id_), "type": "table"},
            "queries": [q], "result_format": "json", "result_type": "results"}
