from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field


MessageRole = Literal["user", "assistant", "system", "unknown"]


class EmailStartRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)


class EmailStartResponse(BaseModel):
    ok: bool = True
    dev_code: str | None = None


class EmailVerifyRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    code: str = Field(min_length=4, max_length=12)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    email: str


class HighlightCreate(BaseModel):
    conversation_id: str = Field(min_length=1, max_length=512)
    conversation_title: str | None = Field(default=None, max_length=512)
    selected_text: str = Field(min_length=1)
    prefix: str = ""
    suffix: str = ""
    text_start: int | None = None
    text_end: int | None = None
    anchor: dict[str, Any] | None = None
    message_index: int = Field(ge=0)
    message_role: MessageRole = "unknown"
    note: str = ""
    color: str = "yellow"


class HighlightPatch(BaseModel):
    note: str | None = None
    color: str | None = None
    is_favorite: bool | None = None


class HighlightOut(BaseModel):
    id: str
    conversation_id: str
    conversation_title: str | None
    selected_text: str
    prefix: str
    suffix: str
    text_start: int | None
    text_end: int | None
    anchor: dict[str, Any] | None
    message_index: int
    message_role: str
    note: str
    color: str
    created_at: datetime

    model_config = {"from_attributes": True}
