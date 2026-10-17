"""Midtrans Snap client for new subscription checkouts."""
import base64
import json
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from . import config


def create_snap_transaction(order_id: str, email: str, customer_name: str, plan_name: str, amount: int) -> dict:
    if not config.MIDTRANS_SERVER_KEY:
        raise ValueError("Midtrans belum dikonfigurasi pada server.")
    api_url = "https://api.midtrans.com" if config.MIDTRANS_IS_PRODUCTION else "https://api.sandbox.midtrans.com"
    credentials = base64.b64encode((config.MIDTRANS_SERVER_KEY + ":").encode()).decode()
    payload = {
        "transaction_details": {"order_id": order_id, "gross_amount": amount},
        "item_details": [{"id": plan_name[:50], "price": amount, "quantity": 1, "name": f"Konvertin {plan_name}"[:50]}],
        "customer_details": {"first_name": customer_name[:50], "email": email},
        "callbacks": {"finish": f"{config.PUBLIC_BASE_URL}/profil.html#billing"} if config.PUBLIC_BASE_URL else {},
    }
    request = Request(
        f"{api_url}/snap/v1/transactions",
        data=json.dumps(payload).encode(),
        headers={
            "Authorization": f"Basic {credentials}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=20) as response:
            result = json.loads(response.read())
    except HTTPError as exc:
        raise ValueError("Midtrans menolak pembuatan pembayaran. Periksa konfigurasi dan status akun gateway.") from exc
    except (URLError, TimeoutError, OSError) as exc:
        raise ValueError("Midtrans tidak dapat dijangkau saat ini. Silakan coba lagi.") from exc
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ValueError("Respons Midtrans tidak dapat dibaca.") from exc
    if not isinstance(result, dict) or not result.get("token") or not result.get("redirect_url"):
        raise ValueError("Respons Midtrans tidak berisi halaman pembayaran yang dapat digunakan.")
    return {
        "id": result["token"],
        "invoice_url": result["redirect_url"],
        "redirect_url": result["redirect_url"],
    }
