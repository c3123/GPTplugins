import requests

from .config import get_settings


def send_login_code(email: str, code: str) -> None:
    settings = get_settings()
    if not settings.resend_api_key:
        print(f"[dev] Login code for {email}: {code}")
        return

    response = requests.post(
        "https://api.resend.com/emails",
        headers={
            "Authorization": f"Bearer {settings.resend_api_key}",
            "Content-Type": "application/json"
        },
        json={
            "from": settings.email_from,
            "to": [email],
            "subject": "Your GPTplugins login code",
            "text": f"Your GPTplugins login code is {code}. It expires soon."
        },
        timeout=10
    )
    response.raise_for_status()
