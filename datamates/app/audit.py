"""모델 변경 이력 — 저장할 때마다 자동으로 남긴다.

변경사항 기록 버튼(수동 git 커밋)을 없애면서 들어왔다. 사용자가 기록을
따로 챙기는 게 아니라, 모델 정의를 바꾸는 API 가 지나갈 때 무엇이 어떻게
바뀌었는지를 메타스토어에 적는다. git 이력은 저장소가 있을 때의 보너스고,
이쪽이 화면의 변경 이력 탭의 원천이다.

주의 — 이 제품은 사용자 신원 기능을 뺐다(권한·이름 제거). 그래서 이력에
누가는 없다. 신원이 다시 들어오면 record() 에 한 필드만 더하면 된다.
"""

from __future__ import annotations

import difflib
from typing import Any

from . import store

# diff 가 수백 KB 가 되면 이력이 로그 저장소가 된다. 화면에서 읽을 만큼만.
_DIFF_LIMIT = 4000


def sql_diff(before: str | None, after: str | None) -> str:
    """unified diff. 화면의 변경 이력 탭이 그대로 보여준다."""
    d = "\n".join(difflib.unified_diff(
        (before or "").splitlines(), (after or "").splitlines(),
        fromfile="변경 전", tofile="변경 후", lineterm=""))
    if len(d) > _DIFF_LIMIT:
        d = d[:_DIFF_LIMIT] + f"\n… (이하 생략 — 전체 {len(d):,}자)"
    return d


def record(model_id: str, entries: list[dict[str, Any]]) -> None:
    """변경 항목들을 한 번의 저장 단위로 기록한다. 빈 목록이면 아무것도 안 한다."""
    entries = [e for e in entries if e]
    if entries:
        store.history_add(model_id, entries)
