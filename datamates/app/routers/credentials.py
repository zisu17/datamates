"""자격증명 — 원천에 붙을 때 쓰는 비밀 값을 한곳에 모은다.

예전에는 커넥터마다 config.auth 안에 값이 직접 들어 있었다. 그러면
  · 같은 서비스 키를 쓰는 커넥터가 셋이면 사본이 셋이고,
  · 키를 갱신할 때 하나를 빠뜨리면 그 커넥터만 조용히 실패하고,
  · 만료일을 적어 둘 자리가 없어 «언제 끊길지» 를 아무도 모른다.
셋 다 «비밀이 커넥터의 속성» 이라고 본 데서 온다. 비밀은 원천 계정의 속성이다.

**secret 은 어떤 응답에도 실리지 않는다**(_view). 화면은 «저장됨» 과 만료일만
본다. 값을 바꿀 때만 새 값을 보내고, 빈 문자열로 보내면 기존 값을 그대로 둔다
(store.credential_upsert).
"""

from __future__ import annotations

import time
from datetime import date
from typing import Any, Literal

from fastapi import APIRouter
from pydantic import BaseModel

from .. import store
from ..errors import ApiError, not_found

router = APIRouter(tags=["credentials"])

# 만료가 이 안에 들어오면 화면이 미리 알린다. 키를 새로 받는 데 걸리는 시간을
# 감안한 값이다 — 공공데이터포털 계열은 신청·승인에 며칠이 걸린다.
SOON_DAYS = 30


class CredentialIn(BaseModel):
    name: str = ""
    kind: Literal["bearer", "header", "param"] = "param"
    param: str = ""
    secret: str = ""
    expires_at: str | None = None
    note: str = ""


def _days_left(expires_at: str | None) -> int | None:
    if not expires_at:
        return None
    try:
        return (date.fromisoformat(str(expires_at)[:10]) - date.today()).days
    except ValueError:
        return None


def _view(c: dict[str, Any]) -> dict[str, Any]:
    """화면이 쓰는 모양. secret 은 있는지 여부만 알린다."""
    left = _days_left(c.get("expires_at"))
    return {
        "id": c["id"], "name": c["name"], "kind": c["kind"], "param": c["param"],
        "expiresAt": c.get("expires_at"), "note": c.get("note") or "",
        "hasSecret": bool(c.get("secret")),
        "daysLeft": left,
        # 상태는 서버가 정한다 — 화면마다 «며칠 남으면 주의» 를 다시 정하면
        # 목록과 상세가 다른 색을 칠한다.
        "state": ("none" if left is None else
                  "expired" if left < 0 else
                  "soon" if left <= SOON_DAYS else "ok"),
        "usedBy": [j["name"] for j in store.ingest_jobs()
                   if ((j.get("config") or {}).get("auth") or {}).get("credential_id") == c["id"]],
        "createdAt": c.get("created_at"), "updatedAt": c.get("updated_at"),
    }


@router.get("/credentials")
def list_credentials() -> dict[str, Any]:
    return {"items": [_view(c) for c in store.credentials()]}


@router.get("/credentials/{cid}")
def get_credential(cid: str) -> dict[str, Any]:
    c = store.credential_get(cid)
    if not c:
        raise not_found("자격증명")
    return _view(c)


@router.post("/credentials", status_code=201)
def create_credential(body: CredentialIn) -> dict[str, Any]:
    if not (body.name or "").strip():
        raise ApiError("INVALID_ARGUMENT", "자격증명 이름을 입력해 주세요.")
    if not (body.secret or "").strip():
        raise ApiError("INVALID_ARGUMENT", "인증 값을 입력해 주세요.")
    if body.kind in ("header", "param") and not (body.param or "").strip():
        raise ApiError("INVALID_ARGUMENT",
                       "헤더 이름 또는 질의 파라미터 이름을 입력해 주세요.")
    cid = f"cred{int(time.time() * 1000)}"
    return _view(store.credential_upsert(cid, body.model_dump()))


@router.patch("/credentials/{cid}")
def update_credential(cid: str, body: CredentialIn) -> dict[str, Any]:
    if not store.credential_get(cid):
        raise not_found("자격증명")
    fields = body.model_dump(exclude_unset=True)
    if "name" in fields and not (fields["name"] or "").strip():
        raise ApiError("INVALID_ARGUMENT", "자격증명 이름을 입력해 주세요.")
    return _view(store.credential_upsert(cid, fields))


@router.delete("/credentials/{cid}", status_code=204)
def delete_credential(cid: str) -> None:
    c = store.credential_get(cid)
    if not c:
        raise not_found("자격증명")
    # 쓰고 있는 커넥터가 있으면 막는다. 지우고 나면 그 커넥터는 다음 실행에서야
    # 실패하는데, 그때는 무엇을 지웠는지 아무도 기억하지 못한다.
    users = _view(c)["usedBy"]
    if users:
        raise ApiError("MODEL_IN_USE",
                       f"{', '.join(users[:5])} 이(가) 이 자격증명을 쓰고 있어 "
                       f"지울 수 없습니다. 커넥터에서 먼저 다른 것을 골라 주세요.")
    store.credential_delete(cid)
