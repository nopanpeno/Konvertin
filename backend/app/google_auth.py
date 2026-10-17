"""Google OpenID Connect authorization-code flow for Konvertin accounts."""
import base64
import hashlib
import json
import time
from hmac import compare_digest
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from . import config


def redirect_uri() -> str:
    if not config.PUBLIC_BASE_URL:
        raise ValueError("KONVERTIN_PUBLIC_BASE_URL belum dikonfigurasi.")
    return f"{config.PUBLIC_BASE_URL}{config.GOOGLE_CALLBACK_PATH}"


def authorization_url(state: str, verifier: str, nonce: str) -> str:
    if not config.GOOGLE_CLIENT_ID or not config.GOOGLE_CLIENT_SECRET:
        raise ValueError("Login Google belum dikonfigurasi di server.")
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    query = urlencode({
        "client_id": config.GOOGLE_CLIENT_ID,
        "redirect_uri": redirect_uri(),
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        "nonce": nonce,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "prompt": "select_account",
    })
    return "https://accounts.google.com/o/oauth2/v2/auth?" + query


def _json_response(request: Request) -> dict:
    try:
        with urlopen(request, timeout=15) as response:
            payload = json.loads(response.read())
    except HTTPError as exc:
        raise ValueError("Google menolak proses login. Periksa konfigurasi OAuth.") from exc
    except (URLError, TimeoutError, OSError) as exc:
        raise ValueError("Layanan Google tidak dapat dijangkau. Coba lagi.") from exc
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ValueError("Respons Google tidak dapat dibaca.") from exc
    if not isinstance(payload, dict):
        raise ValueError("Respons Google tidak valid.")
    return payload


def verify_authorization_code(code: str, verifier: str, nonce: str) -> dict:
    response = _json_response(Request(
        "https://oauth2.googleapis.com/token",
        data=urlencode({
            "code": code,
            "client_id": config.GOOGLE_CLIENT_ID,
            "client_secret": config.GOOGLE_CLIENT_SECRET,
            "redirect_uri": redirect_uri(),
            "grant_type": "authorization_code",
            "code_verifier": verifier,
        }).encode(),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    ))
    id_token = response.get("id_token")
    if not isinstance(id_token, str) or not id_token:
        raise ValueError("Google tidak mengembalikan token identitas.")
    token_parts = id_token.split(".")
    if len(token_parts) != 3:
        raise ValueError("Token identitas Google tidak valid.")
    try:
        encoded_payload = token_parts[1]
        token_claims = json.loads(base64.urlsafe_b64decode(
            encoded_payload + "=" * (-len(encoded_payload) % 4)
        ))
    except (ValueError, json.JSONDecodeError) as exc:
        raise ValueError("Token identitas Google tidak dapat dibaca.") from exc
    if not isinstance(token_claims, dict):
        raise ValueError("Token identitas Google tidak valid.")
    claims = _json_response(Request(
        "https://oauth2.googleapis.com/tokeninfo?" + urlencode({"id_token": id_token}),
        headers={"Accept": "application/json"},
    ))
    try:
        expiry = int(claims.get("exp", 0))
    except (TypeError, ValueError):
        expiry = 0
    email = str(claims.get("email", "")).strip().lower()
    issuer = claims.get("iss")
    if (
        claims.get("aud") != config.GOOGLE_CLIENT_ID
        or issuer not in ("accounts.google.com", "https://accounts.google.com")
        or expiry <= time.time()
        or str(claims.get("email_verified", "")).lower() != "true"
        or not isinstance(token_claims.get("nonce"), str)
        or not compare_digest(token_claims["nonce"], nonce)
    ):
        raise ValueError("Akun Google tidak terverifikasi.")
    return {"email": email, "display_name": str(claims.get("name", "")).strip()}
