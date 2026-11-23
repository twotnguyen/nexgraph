"""Chặn `base_url` của nhà cung cấp LLM trỏ vào mạng nội bộ (SSRF), trừ loopback (R5).

Nhà cung cấp nhận toàn bộ corpus và API key, nên `base_url` do client gửi lên là một kênh đẩy dữ liệu ra.
R5: chặn link-local/metadata (169.254.0.0/16, fe80::/10) và dải nội bộ RFC1918/ULA, nhưng **giữ loopback**
để Ollama/LM Studio cục bộ vẫn dùng được. `NEXGRAPH_ALLOW_HTTP_PROVIDER=1` mở chặn khi phát triển.

Giới hạn đã biết: tên miền được phân giải lúc kiểm rồi urllib phân giải lại lúc gọi (DNS rebinding), nên đây là
giảm thiểu rủi ro chứ không phải bảo đảm tuyệt đối.
"""
from __future__ import annotations

import ipaddress
import os
import socket
from urllib.parse import urlsplit

from graphify.security import _CGN_NETWORK, _ip_is_blocked

ALLOW_ENV = "NEXGRAPH_ALLOW_HTTP_PROVIDER"
_LOOPBACK_NAMES = frozenset({"localhost", "localhost.localdomain"})


def _enabled_by_env() -> bool:
    return os.environ.get(ALLOW_ENV, "").strip().lower() in ("1", "true", "yes", "on")


def _blocked_reason(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> str | None:
    """Lý do chặn, None nếu được phép. Loopback xét trước (R5) vì `_ip_is_blocked` của graphify chặn cả loopback."""
    if ip.is_loopback:
        return None
    if not _ip_is_blocked(ip):
        return None
    if ip.is_link_local:
        return "link-local/metadata"
    if ip.is_unspecified or ip.is_multicast or ip.is_reserved:
        return "dải không định tuyến"
    if ip in _CGN_NETWORK:
        return "mạng nội bộ (CGNAT/Tailscale)"
    return "mạng nội bộ (RFC1918/ULA)"


def _resolve(host: str, port: int) -> list[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except (OSError, UnicodeError):
        return []
    out = []
    for info in infos:
        try:
            out.append(ipaddress.ip_address(info[4][0]))
        except ValueError:
            continue
    return out


def validate_provider_url(url: str) -> str:
    """Trả URL nếu được phép, ném ValueError kèm lý do tiếng Việt nếu không."""
    parsed = urlsplit(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError("base_url phải là http(s)://")
    host = (parsed.hostname or "").strip().lower()
    if not host:
        raise ValueError("base_url thiếu host")
    if _enabled_by_env():
        return url
    if host in _LOOPBACK_NAMES or host.endswith(".localhost"):
        return url
    try:
        literal: ipaddress.IPv4Address | ipaddress.IPv6Address | None = ipaddress.ip_address(host)
    except ValueError:
        literal = None
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    addresses = [literal] if literal is not None else _resolve(host, port)
    if not addresses:
        raise ValueError(f"Không phân giải được host {host}")
    for address in addresses:
        reason = _blocked_reason(address)
        if reason is not None:
            raise ValueError(f"base_url trỏ vào {reason}: {host} → {address}")
    return url
