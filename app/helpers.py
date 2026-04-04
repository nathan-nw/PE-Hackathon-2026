import json
import secrets
import string
from urllib.parse import urlparse

_ALPHANUM = string.ascii_letters + string.digits


def is_valid_http_url(url: str) -> bool:
    if not url or not isinstance(url, str):
        return False
    parsed = urlparse(url.strip())
    if parsed.scheme not in ("http", "https"):
        return False
    return bool(parsed.netloc)


def generate_short_code(length: int = 6) -> str:
    return "".join(secrets.choice(_ALPHANUM) for _ in range(length))


def generate_unique_short_code():
    from app.models.url import Url

    for _ in range(128):
        code = generate_short_code()
        if Url.get_or_none(Url.short_code == code) is None:
            return code
    raise RuntimeError("could not allocate a unique short code")


def dumps_details(data: dict | None) -> str | None:
    if data is None:
        return None
    return json.dumps(data, separators=(",", ":"))
