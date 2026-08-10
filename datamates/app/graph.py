"""파이프라인 실행 그래프 — 실행 대상에서 상류를 끌어와 DAG 을 만든다.

화면에서 순서를 편집하는 UI 는 없다. 순서는 모델의 ref() 관계에서 계산되고,
바꾸려면 모델 SQL 을 고쳐야 한다. 그 계산이 여기다.

프로토타입은 같은 모델을 캔버스에 여러 번 놓을 수 있었지만, dbt 가 SSoT 인
지금은 모델 하나가 DAG 의 노드 하나다(dbt 에 같은 이름의 모델이 둘일 수 없다).
그래서 노드 key 를 모델 id 와 같게 둔다.
"""

from __future__ import annotations

from typing import Any

from . import manifest

# 카드 배치 간격 — 화면의 PW/PH 와 맞춘 값
COL_W, ROW_H = 308, 124


def build(targets: list[str], include_seeds: bool = False,
          stop_at: set[str] | None = None) -> dict[str, Any]:
    """실행 대상 + 그 상류로 DAG 을 만든다.

    상류를 끌어오는 이유: fct_events 만 대상으로 지정해도 stg_events 가 갱신되지
    않으면 결과가 낡는다. dbt 의 `+model` 선택자와 같은 개념이다.

    stop_at 은 다른 파이프라인이 적재를 소유한 모델들이다. 그 모델은
    조회 전용 입력으로 그래프의 시작에 놓이고, 여기서 실행하지도 않고
    그 상류로 더 올라가지도 않는다 — 적재 책임은 소유한 파이프라인에 있다.
    (조회 전용이 항상 시작 지점에만 오는 것은 규칙이 아니라 이 구조의 결과다:
    걷기를 거기서 멈추므로 그 위쪽은 이 그래프에 존재하지 않는다.)

    include_seeds 는 원천 CSV 를 매 실행마다 다시 적재할지 다. 기본은 꺼둔다 —
    seed 는 레포 안의 파일이라 사람이 고칠 때만 바뀌는데, 매번 적재하면 dbt 호출이
    seed 수만큼 늘고 그만큼 Spark 세션 기동 비용(호출당 약 15초)이 붙는다.
    꺼도 그래프에는 그대로 보인다 — 실행 대상에서만 빠진다.
    """
    entries = manifest.all_entries()
    # 대상 자체가 stop 이면 라우터 검증에서 걸렀어야 한다. 방어적으로 대상은 실행한다.
    stop = set(stop_at or ()) - set(targets)
    included: list[str] = []

    def visit(mid: str) -> None:
        if mid in included or mid not in entries:
            return
        if mid in stop:
            included.append(mid)     # 노드로는 보이되, 상류로 더 가지 않는다
            return
        for up in entries[mid]["upstream"]:
            visit(up)          # 상류를 먼저 넣으면 위상 순서가 자연히 맞는다
        included.append(mid)

    for t in targets:
        visit(t)

    # 깊이 = 가장 긴 상류 경로 길이. 같은 깊이는 동시에 실행할 수 있다.
    depth: dict[str, int] = {}

    def walk(mid: str, guard: set[str]) -> int:
        if mid in depth:
            return depth[mid]
        if mid in guard:            # 순환은 dbt 가 먼저 막지만 방어적으로 0 처리
            return 0
        guard.add(mid)
        ups = [u for u in entries[mid]["upstream"] if u in included]
        depth[mid] = max((walk(u, guard) for u in ups), default=-1) + 1
        guard.discard(mid)
        return depth[mid]

    for mid in included:
        walk(mid, set())

    cols: dict[int, list[str]] = {}
    for mid in included:
        cols.setdefault(depth[mid], []).append(mid)

    nodes = []
    for d in sorted(cols):
        for i, mid in enumerate(cols[d]):
            e = entries[mid]
            nodes.append({
                "key": mid, "id": mid, "name": e["name"], "phys": e["phys"],
                "group": e["group"], "kind": e["kind"], "dbt_type": e["dbt_type"],
                "mat": e["mat"], "depth": d, "x": 40 + d * COL_W, "y": 40 + i * ROW_H,
                # source(외부 테이블)는 dbt 가 만들지 않으므로 언제나 실행 대상이 아니다.
                # seed(레포 안 CSV)는 dbt 가 만들 수 있지만, 옵션이 켜졌을 때만 돌린다.
                "executable": (mid not in stop
                               and (e["dbt_type"] == "model"
                                    or (e["dbt_type"] == "seed" and include_seeds))),
                "seed": e["dbt_type"] == "seed",
                # 다른 파이프라인이 적재하는 모델 — 여기서는 읽기만 한다.
                "read_only": mid in stop,
                "is_target": mid in targets,
            })

    edges = [{"from": up, "to": mid}
             for mid in included for up in entries[mid]["upstream"] if up in included]

    # 실행 순서는 모델만. 깊이 → 이름 순으로 안정 정렬해 매번 같은 번호가 나오게 한다.
    order = sorted((n["key"] for n in nodes if n["executable"]),
                   key=lambda k: (depth[k], k))
    seq = {k: i + 1 for i, k in enumerate(order)}
    for n in nodes:
        n["seq"] = seq.get(n["key"])

    return {
        "nodes": nodes,
        "edges": edges,
        "order": order,
        "sources": [n["key"] for n in nodes if not n["executable"]],
        "inputs": [n["key"] for n in nodes if n["read_only"]],
        "missing": [t for t in targets if t not in entries],
    }


# ---------------------------------------------------------------- 적재 소유권

def ownership(pipelines: list[dict[str, Any]]) -> dict[str, str]:
    """모델 → 적재를 소유한 파이프라인 id.

    소유자 = 그 모델을 실제로 실행하는 파이프라인이고, 하나뿐이어야 한다.
    먼저 만든 파이프라인이 이긴다 — 나중 파이프라인의 걷기는 이미 소유된
    모델에서 멈추므로(조회 전용) 같은 모델을 두 번 적재하는 일이 없다.
    """
    owner: dict[str, str] = {}
    for p in sorted(pipelines, key=lambda x: (x.get("created_at") or 0, x["id"])):
        stop = {m for m, o in owner.items() if o != p["id"]}
        flow = build(p.get("targets") or [], bool(p.get("include_seeds")), stop_at=stop)
        for m in flow["order"]:
            owner.setdefault(m, p["id"])
    return owner


def stops_for(pid: str | None, owner: dict[str, str]) -> set[str]:
    """이 파이프라인 입장에서 남의 모델 목록."""
    return {m for m, o in owner.items() if o != pid}


def flow_for(pipeline: dict[str, Any], pipelines: list[dict[str, Any]],
             owner: dict[str, str] | None = None) -> dict[str, Any]:
    """소유권을 반영한 이 파이프라인의 실행 그래프.

    남의 모델(다른 파이프라인이 적재하는 것)에서 걷기를 멈춰 조회 전용 입력으로
    남긴다. 여러 파이프라인을 돌며 부를 때는 ownership() 결과를 owner 로 넘겨
    소유권 계산을 한 번만 하게 한다.
    """
    if owner is None:
        owner = ownership(pipelines)
    return build(pipeline.get("targets") or [], bool(pipeline.get("include_seeds")),
                 stop_at=stops_for(pipeline["id"], owner))


def downstream_of(order: list[str], start: str, edges: list[dict[str, str]]) -> list[str]:
    """start 부터 재실행할 때 실제로 다시 돌려야 할 모델들.

    단순히 order 를 잘라 쓰면 안 된다 — start 와 무관한 옆가지까지 다시 돈다.
    start 에서 도달 가능한 노드만 고르고, 순서는 order 를 따른다.
    """
    adj: dict[str, list[str]] = {}
    for e in edges:
        adj.setdefault(e["from"], []).append(e["to"])

    reach = {start}
    stack = [start]
    while stack:
        cur = stack.pop()
        for nxt in adj.get(cur, []):
            if nxt not in reach:
                reach.add(nxt)
                stack.append(nxt)

    return [k for k in order if k in reach]
