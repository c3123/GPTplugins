from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from .config import get_settings
from .db import get_db
from .emailer import send_login_code
from .models import Conversation, Highlight, LoginCode, User
from .schemas import EmailStartRequest, EmailStartResponse, EmailVerifyRequest, HighlightCreate, HighlightOut, HighlightPatch, TokenResponse
from .security import create_token, generate_code, get_current_user, hash_code, now_utc

router = APIRouter()


def normalize_email(email: str) -> str:
    return email.strip().lower()


def highlight_out(row: Highlight) -> HighlightOut:
    return HighlightOut(
        id=row.id,
        conversation_id=row.conversation.chatgpt_conversation_id,
        conversation_title=row.conversation.title,
        selected_text=row.selected_text,
        prefix=row.prefix,
        suffix=row.suffix,
        text_start=row.text_start,
        text_end=row.text_end,
        anchor=row.anchor,
        message_index=row.message_index,
        message_role=row.message_role,
        note=row.note,
        color=row.color,
        created_at=row.created_at
    )


def get_or_create_conversation(db: Session, user: User, chatgpt_id: str, title: str | None) -> Conversation:
    conversation = db.scalar(
        select(Conversation).where(
            Conversation.user_id == user.id,
            Conversation.chatgpt_conversation_id == chatgpt_id
        )
    )
    if conversation:
        if title and conversation.title != title:
            conversation.title = title
        return conversation

    conversation = Conversation(user_id=user.id, chatgpt_conversation_id=chatgpt_id, title=title)
    db.add(conversation)
    db.flush()
    return conversation


@router.post("/auth/email/start", response_model=EmailStartResponse)
def start_email_auth(payload: EmailStartRequest, db: Session = Depends(get_db)) -> EmailStartResponse:
    settings = get_settings()
    email = normalize_email(payload.email)
    code = generate_code()
    login_code = LoginCode(
        email=email,
        code_hash=hash_code(email, code),
        expires_at=now_utc() + timedelta(minutes=settings.login_code_expires_minutes)
    )
    db.add(login_code)
    db.commit()
    send_login_code(email, code)
    return EmailStartResponse(dev_code=code if settings.dev_auth_codes else None)


@router.post("/auth/email/verify", response_model=TokenResponse)
def verify_email_auth(payload: EmailVerifyRequest, db: Session = Depends(get_db)) -> TokenResponse:
    email = normalize_email(payload.email)
    code_hash = hash_code(email, payload.code)
    login_code = db.scalar(
        select(LoginCode)
        .where(
            LoginCode.email == email,
            LoginCode.code_hash == code_hash,
            LoginCode.used.is_(False),
            LoginCode.expires_at > now_utc()
        )
        .order_by(desc(LoginCode.created_at))
    )
    if not login_code:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired code")

    login_code.used = True
    user = db.scalar(select(User).where(User.email == email))
    if not user:
        user = User(email=email)
        db.add(user)
        db.flush()
    db.commit()
    return TokenResponse(access_token=create_token(user), email=user.email)


@router.get("/conversations/{conversation_id}/highlights", response_model=list[HighlightOut])
def list_conversation_highlights(
    conversation_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> list[HighlightOut]:
    rows = db.scalars(
        select(Highlight)
        .join(Conversation)
        .where(
            Highlight.user_id == current_user.id,
            Conversation.chatgpt_conversation_id == conversation_id
        )
        .order_by(Highlight.created_at.asc())
    ).all()
    return [highlight_out(row) for row in rows]


@router.post("/highlights", response_model=HighlightOut, status_code=status.HTTP_201_CREATED)
def create_highlight(
    payload: HighlightCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> HighlightOut:
    conversation = get_or_create_conversation(db, current_user, payload.conversation_id, payload.conversation_title)
    row = Highlight(
        user_id=current_user.id,
        conversation_id=conversation.id,
        selected_text=payload.selected_text,
        prefix=payload.prefix,
        suffix=payload.suffix,
        text_start=payload.text_start,
        text_end=payload.text_end,
        anchor=payload.anchor,
        message_index=payload.message_index,
        message_role=payload.message_role,
        note=payload.note,
        color=payload.color
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return highlight_out(row)


@router.patch("/highlights/{highlight_id}", response_model=HighlightOut)
def patch_highlight(
    highlight_id: str,
    payload: HighlightPatch,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> HighlightOut:
    row = db.scalar(select(Highlight).where(Highlight.id == highlight_id, Highlight.user_id == current_user.id))
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Highlight not found")
    if payload.note is not None:
        row.note = payload.note
    if payload.color is not None:
        row.color = payload.color
    if payload.is_favorite is not None:
        row.is_favorite = payload.is_favorite
    db.commit()
    db.refresh(row)
    return highlight_out(row)


@router.delete("/highlights/{highlight_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_highlight(
    highlight_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
) -> None:
    row = db.scalar(select(Highlight).where(Highlight.id == highlight_id, Highlight.user_id == current_user.id))
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Highlight not found")
    db.delete(row)
    db.commit()
