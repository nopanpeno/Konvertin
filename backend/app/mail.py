"""SMTP email delivery for account verification and account notices."""
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr
from urllib.parse import urlsplit

from . import config


class EmailDeliveryError(Exception):
    """Raised when the configured SMTP server cannot deliver a message."""


def configured() -> bool:
    if not config.SMTP_HOST or not config.SMTP_FROM_EMAIL or not config.PUBLIC_BASE_URL:
        return False
    if bool(config.SMTP_USERNAME) != bool(config.SMTP_PASSWORD):
        return False
    if config.SMTP_USE_SSL and config.SMTP_STARTTLS:
        return False
    if not 1 <= config.SMTP_PORT <= 65535:
        return False
    base = urlsplit(config.PUBLIC_BASE_URL)
    return bool(
        base.netloc and not base.username and not base.password and not base.query and not base.fragment
        and (base.scheme == "https" or (base.scheme == "http" and base.hostname in ("localhost", "127.0.0.1")))
    )


def _send(recipient: str, subject: str, body: str) -> None:
    if not configured():
        raise EmailDeliveryError("Pengiriman email belum dikonfigurasi.")
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = formataddr((config.SMTP_FROM_NAME, config.SMTP_FROM_EMAIL))
    message["To"] = recipient
    message.set_content(body)
    try:
        if config.SMTP_USE_SSL:
            with smtplib.SMTP_SSL(
                config.SMTP_HOST, config.SMTP_PORT, timeout=15, context=ssl.create_default_context()
            ) as server:
                if config.SMTP_USERNAME:
                    server.login(config.SMTP_USERNAME, config.SMTP_PASSWORD)
                server.send_message(message)
        else:
            with smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT, timeout=15) as server:
                server.ehlo()
                if config.SMTP_STARTTLS:
                    server.starttls(context=ssl.create_default_context())
                    server.ehlo()
                if config.SMTP_USERNAME:
                    server.login(config.SMTP_USERNAME, config.SMTP_PASSWORD)
                server.send_message(message)
    except (OSError, smtplib.SMTPException) as exc:
        raise EmailDeliveryError("Email tidak dapat dikirim. Periksa konfigurasi SMTP.") from exc


def send_verification(recipient: str, display_name: str, verification_url: str) -> None:
    _send(
        recipient,
        "Verifikasi email akun Konvertin",
        f"Halo {display_name},\n\n"
        "Verifikasi alamat email untuk mengaktifkan akun Konvertin kamu dengan membuka tautan ini:\n"
        f"{verification_url}\n\n"
        "Tautan hanya berlaku selama 24 jam dan dapat digunakan satu kali. "
        "Jika kamu tidak membuat akun ini, abaikan email ini.",
    )


def send_account_notice(recipient: str, display_name: str, title: str, body: str) -> None:
    _send(
        recipient,
        f"Notifikasi akun Konvertin: {title}",
        f"Halo {display_name},\n\n{body}\n\nTim Konvertin",
    )
