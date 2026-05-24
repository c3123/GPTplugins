import os
from pathlib import Path

os.environ["DATABASE_URL"] = f"sqlite:///{Path(__file__).parent / 'test.sqlite3'}"
os.environ["JWT_SECRET"] = "test-secret"
os.environ["DEV_AUTH_CODES"] = "true"

from fastapi.testclient import TestClient  # noqa: E402

from app.db import Base, engine  # noqa: E402
from app.main import app  # noqa: E402


def reset_db() -> None:
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)


def auth_headers(client: TestClient, email: str = "user@example.com") -> dict[str, str]:
    response = client.post("/auth/email/start", json={"email": email})
    assert response.status_code == 200
    code = response.json()["dev_code"]
    response = client.post("/auth/email/verify", json={"email": email, "code": code})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def highlight_payload(**overrides):
    payload = {
        "conversation_id": "chatgpt-conversation-1",
        "conversation_title": "Test conversation",
        "selected_text": "selected text",
        "prefix": "prefix ",
        "suffix": " suffix",
        "text_start": 7,
        "text_end": 20,
        "anchor": {"exact": "selected text", "start": 7, "end": 20},
        "message_index": 1,
        "message_role": "assistant",
        "note": "my note",
        "color": "yellow"
    }
    payload.update(overrides)
    return payload


def test_email_code_login_flow() -> None:
    reset_db()
    client = TestClient(app)

    start = client.post("/auth/email/start", json={"email": "User@Example.com"})
    assert start.status_code == 200
    code = start.json()["dev_code"]
    assert code

    verify = client.post("/auth/email/verify", json={"email": "user@example.com", "code": code})
    assert verify.status_code == 200
    assert verify.json()["access_token"]
    assert verify.json()["email"] == "user@example.com"

    reused = client.post("/auth/email/verify", json={"email": "user@example.com", "code": code})
    assert reused.status_code == 400


def test_auth_required() -> None:
    reset_db()
    client = TestClient(app)
    response = client.get("/conversations/chatgpt-conversation-1/highlights")
    assert response.status_code == 401


def test_highlight_crud_and_user_isolation() -> None:
    reset_db()
    client = TestClient(app)
    user_one = auth_headers(client, "one@example.com")
    user_two = auth_headers(client, "two@example.com")

    created = client.post("/highlights", headers=user_one, json=highlight_payload())
    assert created.status_code == 201
    highlight_id = created.json()["id"]
    assert created.json()["selected_text"] == "selected text"
    assert "message_text" not in created.json()

    listed = client.get("/conversations/chatgpt-conversation-1/highlights", headers=user_one)
    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()] == [highlight_id]

    isolated = client.get("/conversations/chatgpt-conversation-1/highlights", headers=user_two)
    assert isolated.status_code == 200
    assert isolated.json() == []

    patched = client.patch("/highlights/" + highlight_id, headers=user_one, json={"note": "updated"})
    assert patched.status_code == 200
    assert patched.json()["note"] == "updated"

    forbidden_delete = client.delete("/highlights/" + highlight_id, headers=user_two)
    assert forbidden_delete.status_code == 404

    deleted = client.delete("/highlights/" + highlight_id, headers=user_one)
    assert deleted.status_code == 204
    listed_again = client.get("/conversations/chatgpt-conversation-1/highlights", headers=user_one)
    assert listed_again.json() == []
