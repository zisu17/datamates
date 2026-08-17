"""홈 화면이 쓰는 값을 **한 번에** 돌려준다.

왜 따로 두나
------------
홈은 원래 여덟 곳을 각각 불렀다 — /catalog/volume · /history/summary(1일·7일) ·
/history/slowest(1일·7일) · /history/daily · /history/runs · /storage.
브라우저는 출처당 동시 연결이 여섯 개(HTTP/1.1)라 나머지는 큐에서 기다리고, 그
줄에 **다른 화면의 요청까지 끼어 밀린다.** 실측: 데이터 모델로 바로 들어가도
부팅이 홈을 한 번 그리며 여덟 개를 던져, 49ms 짜리 /lineage 가 712ms 에야 시작했다.

그래서 왕복을 하나로 접는다. 서버 안에서는 여전히 동시에 돌린다 — 직렬로 바꾸면
개별 소요(258~529ms)가 그대로 더해져 3초가 넘는다. warehouse.query 는 실행마다
cursor() 를 따로 떠서 동시 실행이 안전하다(warehouse.py 의 측정 주석 참고).

창이 겹치는 두 쌍은 스캔을 합쳤다
--------------------------------
summary 와 slowest 는 1일·7일 두 벌을 따로 부르는데, 1일은 7일에 포함된다.
7일치를 한 번 훑으면서 `filter (where ... >= 1일)` 로 1일 값을 같이 뽑으면
테이블 스캔이 절반이 된다. 결과는 기존 엔드포인트와 같아야 하며, 실제로 같은지는
/home/summary:verify 가 두 경로를 모두 돌려 비교한다.

기존 엔드포인트는 그대로 둔다 — 이 라우터는 홈 전용 묶음이고, 개별 값은 다른
화면과 외부에서 계속 쓴다.
"""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter
from starlette.concurrency import run_in_threadpool

from . import catalog as catalog_router
from . import history as h
from . import storage as storage_router

router = APIRouter(prefix="/home", tags=["home"])

# 홈이 보는 두 창. 1일이 7일에 포함되는 것이 스캔을 합칠 수 있는 근거다.
SHORT_DAYS = 1
LONG_DAYS = 7
# 홈 도넛은 상위 5개만 그리지만, 「비중」은 100개 합계 기준으로 계산해 온 값이라
# 그 기준을 유지한다. 여기서 100 을 줄이면 화면의 % 가 조용히 달라진다.
SLOW_LIMIT = 100
DAILY_DAYS = 14
RUNS_LIMIT = 8


def _spans() -> dict[str, Any]:
    """summary 1일·7일 — 7일치 한 번 훑어 두 벌을 함께 만든다."""
    short = h._since(SHORT_DAYS)
    long_ = h._since(LONG_DAYS)
    ts_inv = h.TS.format("run_started_at")
    ts_res = h.TS.format("generated_at")
    node = "resource_type in ('model','seed','snapshot')"
    test = "resource_type in ('test','unit_test')"
    sec = "CAST(execution_time AS DOUBLE)"

    inv = h._one(f"""
        select
          count(*) filter (where {ts_inv} >= {short}) runs_s,
          count(*) filter (where {ts_inv} >= {long_}) runs_l,
          min({ts_inv}) filter (where {ts_inv} >= {short}) first_s,
          max({ts_inv}) filter (where {ts_inv} >= {short}) last_s,
          min({ts_inv}) filter (where {ts_inv} >= {long_}) first_l,
          max({ts_inv}) filter (where {ts_inv} >= {long_}) last_l
        from {h.EL}.dbt_invocations
        where {ts_inv} >= {long_}""")

    def agg(suffix: str, window: str) -> str:
        return f"""
          count(*) filter (where {node} and {ts_res} >= {window}) nodeRuns_{suffix},
          count(*) filter (where {node} and status not in ('success','pass')
                             and {ts_res} >= {window}) nodeFails_{suffix},
          round(sum({sec}) filter (where {node} and {ts_res} >= {window}), 1) buildSeconds_{suffix},
          count(*) filter (where {test} and {ts_res} >= {window}) testRuns_{suffix},
          count(*) filter (where {test} and status = 'pass'
                             and {ts_res} >= {window}) testPass_{suffix},
          count(*) filter (where {test} and status = 'warn'
                             and {ts_res} >= {window}) testWarn_{suffix},
          count(*) filter (where {test} and status in ('fail','error')
                             and {ts_res} >= {window}) testFail_{suffix}"""

    node_row = h._one(f"""
        select {agg('s', short)}, {agg('l', long_)}
        from {h.EL}.dbt_run_results
        where {ts_res} >= {long_}""")

    def build(sfx: str, days: int) -> dict[str, Any]:
        nr = node_row.get(f"nodeRuns_{sfx}") or 0
        nf = node_row.get(f"nodeFails_{sfx}") or 0
        tr = node_row.get(f"testRuns_{sfx}") or 0
        tp = node_row.get(f"testPass_{sfx}") or 0
        return {
            "days": days,
            "runs": inv.get(f"runs_{sfx}") or 0,
            "firstRun": inv.get(f"first_{sfx}"), "lastRun": inv.get(f"last_{sfx}"),
            "nodeRuns": nr, "nodeFails": nf,
            "successRate": round((nr - nf) / nr * 100, 1) if nr else None,
            "buildSeconds": node_row.get(f"buildSeconds_{sfx}"),
            "test": {"runs": tr, "pass": tp,
                     "warn": node_row.get(f"testWarn_{sfx}") or 0,
                     "fail": node_row.get(f"testFail_{sfx}") or 0,
                     "passRate": round(tp / tr * 100, 1) if tr else None},
            "note": "실행은 dbt invocation 단위입니다. 파이프라인 한 번에 여러 번 생길 수 있습니다.",
        }

    return {"short": build("s", SHORT_DAYS), "long": build("l", LONG_DAYS)}


def _slowest() -> dict[str, Any]:
    """slowest 1일·7일 — 마찬가지로 7일치 한 번에 두 벌.

    정렬·상한은 창마다 다르므로 파이썬에서 나눈다. 그룹 수는 모델 수만큼이라
    (지금 15개) 옮겨 담는 비용이 스캔을 한 번 더 하는 것보다 훨씬 싸다.
    """
    short = h._since(SHORT_DAYS)
    long_ = h._since(LONG_DAYS)
    ts = h.TS.format("generated_at")
    sec = "CAST(execution_time AS DOUBLE)"

    rows = h._rows(f"""
        select name,
          count(*) filter (where {ts} >= {short}) runs_s,
          round(sum({sec}) filter (where {ts} >= {short}), 1) total_s,
          round(avg({sec}) filter (where {ts} >= {short}), 2) avg_s,
          round(max({sec}) filter (where {ts} >= {short}), 2) max_s,
          count(*) filter (where {ts} >= {long_}) runs_l,
          round(sum({sec}) filter (where {ts} >= {long_}), 1) total_l,
          round(avg({sec}) filter (where {ts} >= {long_}), 2) avg_l,
          round(max({sec}) filter (where {ts} >= {long_}), 2) max_l
        from {h.EL}.dbt_run_results
        where {ts} >= {long_}
          and resource_type in ('model','seed','snapshot')
        group by 1""")

    def pick(sfx: str, days: int) -> dict[str, Any]:
        # 그 창에 실행이 없는 모델은 빼야 한다 — 원래 쿼리는 where 로 걸러
        # 아예 행이 생기지 않았다. filter 는 행을 남기고 값만 null 로 둔다.
        items = [{"name": r["name"], "runs": r[f"runs_{sfx}"] or 0,
                  "totalSeconds": r[f"total_{sfx}"], "avgSeconds": r[f"avg_{sfx}"],
                  "maxSeconds": r[f"max_{sfx}"]}
                 for r in rows if (r[f"runs_{sfx}"] or 0) > 0]
        # 동점은 이름으로 끊는다 — 기존 SQL 의 `order by totalSeconds desc, name` 과
        # 같은 기준이어야 두 경로가 같은 목록을 낸다(:verify 가 이걸 잡아냈다).
        items.sort(key=lambda i: (-(i["totalSeconds"] or 0), i["name"]))
        items = items[:SLOW_LIMIT]
        total = sum(i["totalSeconds"] or 0 for i in items)
        for i in items:
            i["share"] = round((i["totalSeconds"] or 0) / total * 100, 1) if total else 0
        return {"items": items, "total": len(items), "days": days}

    return {"short": pick("s", SHORT_DAYS), "long": pick("l", LONG_DAYS)}


def _storage_safe() -> dict[str, Any]:
    """저장소만 따로 삼킨다 — MinIO 를 직접 훑는 유일한 호출이라 저장소가 내려가
    있으면 여기만 실패한다. 그 하나 때문에 홈 전체가 «불러오지 못했습니다» 가
    되면 나머지 멀쩡한 값까지 못 보게 된다(옛 프런트가 하던 처리를 옮겼다).

    다른 라우터의 핸들러를 **평범한 함수로 부를 때는 기본값을 반드시 넘긴다.**
    시그니처가 `refresh: bool = Query(False)` 라 인자를 생략하면 파이썬은 기본값으로
    `Query(False)` **객체**를 넣는다. 그 객체는 truthy 라 `if not refresh` 가 늘
    거짓이 되고, 300초짜리 캐시를 매번 무시한 채 MinIO 를 통째로 다시 훑는다.
    실측: 캐시를 태울 때 2ms, 이 실수로는 740ms — /home/summary 전체를 혼자
    좌우했다. 아래 catalog_volume · daily · runs 도 같은 이유로 값을 명시한다.
    """
    try:
        return {"ok": storage_router.storage(False)}
    except Exception as e:      # noqa: BLE001
        return {"error": str(e)[:200]}


@router.get("/summary")
async def home_summary() -> dict[str, Any]:
    """홈이 필요한 것 전부. 프런트의 HOME.data 모양 그대로 돌려준다."""
    spans, slow, vol, daily, runs, st = await asyncio.gather(
        run_in_threadpool(_spans),
        run_in_threadpool(_slowest),
        run_in_threadpool(catalog_router.catalog_volume, False),
        run_in_threadpool(h.daily, DAILY_DAYS),
        run_in_threadpool(h.runs, SHORT_DAYS, RUNS_LIMIT, None),
        run_in_threadpool(_storage_safe),
    )
    return {
        "vol": vol,
        "span": {
            "24h": {"sum": spans["short"], "slow": slow["short"]["items"], "label": "24시간"},
            "7d": {"sum": spans["long"], "slow": slow["long"]["items"], "label": "7일"},
        },
        "daily": daily["items"],
        "runs": runs["items"],
        "storage": st.get("ok"),
        "storageError": st.get("error"),
    }


@router.get("/summary:verify")
async def home_summary_verify() -> dict[str, Any]:
    """합친 질의가 기존 엔드포인트와 같은 값을 내는지 확인한다.

    창을 합치는 최적화는 filter 조건 하나만 틀려도 **조용히** 다른 숫자를 낸다.
    화면에서 눈으로 보고 알아챌 수 있는 종류가 아니라서, 두 경로를 모두 돌려
    비교하는 자리를 코드 옆에 둔다. 운영에서 부를 일은 없고 손볼 때 쓴다.
    """
    merged_spans, merged_slow = await asyncio.gather(
        run_in_threadpool(_spans), run_in_threadpool(_slowest))
    old_s1, old_s7, old_l1, old_l7 = await asyncio.gather(
        run_in_threadpool(h.summary, SHORT_DAYS),
        run_in_threadpool(h.summary, LONG_DAYS),
        run_in_threadpool(h.slowest, SHORT_DAYS, SLOW_LIMIT),
        run_in_threadpool(h.slowest, LONG_DAYS, SLOW_LIMIT),
    )
    diffs: list[str] = []

    def cmp(label: str, a: Any, b: Any) -> None:
        if a != b:
            diffs.append(f"{label}: 합친 값 {a!r} != 기존 {b!r}")

    for label, merged, old in (("summary 1일", merged_spans["short"], old_s1),
                               ("summary 7일", merged_spans["long"], old_s7)):
        for k in old:
            cmp(f"{label}.{k}", merged.get(k), old.get(k))
    for label, merged, old in (("slowest 1일", merged_slow["short"], old_l1),
                               ("slowest 7일", merged_slow["long"], old_l7)):
        cmp(f"{label}.total", merged["total"], old["total"])
        cmp(f"{label}.items", merged["items"], old["items"])

    return {"ok": not diffs, "diffs": diffs,
            "checked": ["summary 1일", "summary 7일", "slowest 1일", "slowest 7일"]}
