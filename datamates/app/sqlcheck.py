"""모델 SQL 감사 — 「하나의 SQL로 하나의 데이터 모델」 규칙을 지키게 한다.

화면이 저장 버튼 옆에서 즉시 보여줄 결과라 dbt 를 돌리지 않고 정규식으로 본다.
정확한 의존관계는 저장 후 `dbt parse` 가 만든 manifest 가 알려주므로,
여기서는 명백히 잘못된 것만 빠르게 걸러내는 역할이다.

걸러내는 것
  - 문장이 2개 이상 (모델 하나는 SELECT 하나다)
  - DDL/DML (create/insert/merge/delete/update/drop)
  - 존재하지 않는 모델을 ref() 로 부르는 경우
"""

from __future__ import annotations

import re
from typing import Any

_LINE_COMMENT = re.compile(r"--[^\n]*")
_BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.S)
_JINJA_BLOCK = re.compile(r"\{%.*?%\}", re.S)
_STRING = re.compile(r"'(?:[^']|'')*'")

_DDL = re.compile(
    r"\b(insert\s+into|create\s+(?:or\s+replace\s+)?(?:table|view|schema|database)"
    r"|drop\s+(?:table|view|schema|database)|merge\s+into|truncate\s+table"
    r"|update\s+\w+\s+set|delete\s+from|alter\s+table|grant\s+|revoke\s+)\b",
    re.I,
)
_CTE_NAME = re.compile(r"(?:\bwith\b|,)\s+([a-z_][\w]*)\s+as\s*\(", re.I)
_SELECT = re.compile(r"\bselect\b", re.I)

_REF = re.compile(r"\{\{\s*ref\s*\(\s*['\"]([^'\"]+)['\"]\s*\)\s*\}\}")
_SOURCE = re.compile(r"\{\{\s*source\s*\(\s*['\"]([^'\"]+)['\"]\s*,\s*['\"]([^'\"]+)['\"]\s*\)\s*\}\}")


def _strip(sql: str) -> str:
    """주석·문자열·Jinja 제어블록을 지운 구조만 남은 본문.

    문자열을 먼저 지우는 이유: 리터럴 안의 세미콜론이나 'create table' 이
    문장 수·DDL 판정을 오염시킨다. Jinja 제어블록({% if %})도 지운다 —
    그 안의 조건문은 SQL 문장이 아니다.
    """
    s = _BLOCK_COMMENT.sub(" ", sql)
    s = _LINE_COMMENT.sub(" ", s)
    s = _JINJA_BLOCK.sub(" ", s)
    s = _STRING.sub("''", s)
    return s


def parse_refs(sql: str) -> dict[str, list[str]]:
    """ref() / source() 를 뽑는다. 주석 안의 것은 세지 않는다."""
    body = _BLOCK_COMMENT.sub(" ", _LINE_COMMENT.sub(" ", sql))
    refs = list(dict.fromkeys(_REF.findall(body)))
    sources = list(dict.fromkeys(f"{a}.{b}" for a, b in _SOURCE.findall(body)))
    return {"refs": refs, "sources": sources}


def audit(sql: str) -> dict[str, Any]:
    body = _strip(sql)
    stmts = [x for x in (p.strip() for p in body.split(";")) if x]
    ddl = _DDL.search(body)
    return {
        "stmts": len(stmts),
        "cte": len(_CTE_NAME.findall(body)),
        "cte_names": _CTE_NAME.findall(body),
        "ddl": ddl.group(0).strip() if ddl else None,
        "selects": len(_SELECT.findall(body)),
    }


def validate(sql: str, known_ids: set[str]) -> dict[str, Any]:
    """감사 결과 + 사람이 읽을 판정. known_ids 는 카탈로그에 실재하는 모델 id 집합."""
    a = audit(sql)
    parsed = parse_refs(sql)
    missing = [r for r in parsed["refs"] if r not in known_ids]

    errors: list[str] = []
    if a["stmts"] > 1:
        errors.append(f"SQL 문장이 {a['stmts']}개입니다. 모델 하나는 SQL 하나여야 합니다.")
    if a["ddl"]:
        errors.append(f"{a['ddl']} 은(는) 쓸 수 없습니다. 모델은 SELECT 하나로 정의합니다.")
    if a["selects"] == 0:
        errors.append("SELECT 가 없습니다. 모델은 조회 결과로 정의합니다.")
    if missing:
        errors.append(f"없는 데이터를 참조합니다: {', '.join(missing)}")

    return {
        "ok": not errors,
        "errors": errors,
        "message": (f"SQL 정상 · 출력 1개 · CTE {a['cte']}개 · "
                    f"참조 {len(parsed['refs']) + len(parsed['sources'])}건")
        if not errors else errors[0],
        **a,
        **parsed,
        "missing_refs": missing,
    }
