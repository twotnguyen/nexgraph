"""REV-12: base_url của nhà cung cấp LLM không được trỏ vào mạng nội bộ/link-local (SSRF), trừ loopback (R5)."""
import pytest

from nexgraph_engine.semantic.transport import check_base_url


@pytest.mark.parametrize("url", ["http://127.0.0.1:11434/v1", "http://localhost:1234/v1",
                                 "http://[::1]:8080/v1", "https://8.8.8.8/v1"])
def test_loopback_and_public_hosts_are_allowed(url):
    assert check_base_url(url) == url.rstrip("/")


@pytest.mark.parametrize("url,reason", [
    ("http://169.254.169.254/latest/meta-data", "link-local"),
    ("http://10.0.0.5:8000/v1", "nội bộ"),
    ("http://192.168.1.10:8080/v1", "nội bộ"),
    ("http://172.16.4.4/v1", "nội bộ"),
    ("http://[fd00::1]:8080/v1", "nội bộ"),
    ("http://0.0.0.0:8080/v1", "không định tuyến"),
])
def test_internal_and_metadata_hosts_are_blocked(url, reason):
    with pytest.raises(ValueError) as exc:
        check_base_url(url)
    assert reason in str(exc.value)


def test_dev_flag_allows_an_internal_host(monkeypatch):
    monkeypatch.setenv("NEXGRAPH_ALLOW_HTTP_PROVIDER", "1")
    assert check_base_url("http://10.0.0.5:8000/v1") == "http://10.0.0.5:8000/v1"


def test_unresolvable_host_is_rejected(monkeypatch):
    with pytest.raises(ValueError):
        check_base_url("http://khong-ton-tai.invalid/v1")


def test_scheme_outside_http_is_rejected():
    for url in ("file:///etc/passwd", "ftp://10.0.0.1/x", "gopher://127.0.0.1:9/"):
        with pytest.raises(ValueError):
            check_base_url(url)
