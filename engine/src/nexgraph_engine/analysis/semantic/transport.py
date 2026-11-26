"""Hai đường gọi model.

- Đường B (`DirectTransport`): engine gửi `POST {base_url}/chat/completions` đúng dạng backend `openai` của vendor
  (`llm._call_openai_compat`), với `base_url`/key/model do main truyền xuống. Key chỉ nằm trong đối tượng này.
- Đường A (`LlmQueue`): engine xếp khối vào hàng đợi; main kéo khối, gọi model bằng tài khoản app, rồi gửi kết quả.
"""
from __future__ import annotations

import json
import queue
import threading
import urllib.error
import urllib.request
from collections import deque

from nexgraph_engine.adapters.graphify.llm import _LLM_JSON_MAX_BYTES, _openai_max_tokens_kwarg, _resolve_temperature, provider_base_url_ok

from nexgraph_engine.analysis.semantic.chunks import Chunk
from nexgraph_engine.analysis.semantic.url_guard import validate_provider_url


class ChunkError(Exception):
    """Một khối hỏng (model lỗi, JSON hỏng, thiếu trường). Job vẫn chạy tiếp các khối khác."""


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    # urllib chép cả header Authorization sang host mới khi chuyển hướng: không cho key đi tiếp.
    def redirect_request(self, *args, **kwargs):
        return None


_OPENER = urllib.request.build_opener(_NoRedirect)


def check_base_url(base_url: str) -> str:
    url = base_url.strip().rstrip("/")
    if not url or not provider_base_url_ok(url, "direct", warn=False):
        raise ValueError("base_url phải là http(s)://")
    return validate_provider_url(url)


class DirectTransport:
    def __init__(self, base_url: str, api_key: str, model: str, *, timeout: float = 600.0) -> None:
        self.base_url, self.model, self.timeout = check_base_url(base_url), model, timeout
        self._api_key = api_key

    def __repr__(self) -> str:  # không để key lọt vào traceback/log
        return f"DirectTransport(base_url={self.base_url!r}, model={self.model!r})"

    def complete(self, chunk: Chunk) -> tuple[str, int, int]:
        """Trả (text, input_tokens, output_tokens). Lỗi mạng/HTTP thành ChunkError không chứa key."""
        content: str | list = chunk.user
        if chunk.images:
            content = [{"type": "text", "text": chunk.user}, *(
                {"type": "image_url", "image_url": {"url": f"data:{t};base64,{b}", "detail": "auto"}}
                for b, t in zip(chunk.images, chunk.image_types))]
        body = {"model": self.model, "stream": False,
                "messages": [{"role": "system", "content": chunk.system}, {"role": "user", "content": content}],
                **_openai_max_tokens_kwarg("openai", chunk.max_output_tokens)}
        temperature = _resolve_temperature(0, self.model)
        if temperature is not None:
            body["temperature"] = temperature
        headers = {"Content-Type": "application/json"}
        if self._api_key:
            headers["Authorization"] = f"Bearer {self._api_key}"
        request = urllib.request.Request(f"{self.base_url}/chat/completions", data=json.dumps(body).encode("utf-8"),
                                         headers=headers, method="POST")
        try:
            with _OPENER.open(request, timeout=self.timeout) as response:
                raw = response.read(_LLM_JSON_MAX_BYTES + 1)
        except urllib.error.HTTPError as exc:
            raise ChunkError(f"Model trả về HTTP {exc.code}") from None
        except (urllib.error.URLError, OSError) as exc:
            raise ChunkError(f"Không gọi được model ({type(exc).__name__})") from None
        if len(raw) > _LLM_JSON_MAX_BYTES:
            raise ChunkError("Phản hồi của model quá lớn")
        try:
            data = json.loads(raw)
            text = data["choices"][0]["message"]["content"] or ""
        except (ValueError, KeyError, IndexError, TypeError, RecursionError, MemoryError):
            raise ChunkError("Phản hồi của model không đúng định dạng OpenAI") from None
        usage = data.get("usage") or {}
        return str(text), int(usage.get("prompt_tokens") or 0), int(usage.get("completion_tokens") or 0)


class LlmQueue:
    """Hàng đợi khối của một job đường A. Engine `offer` rồi `wait`; main gọi `next` và `answer` qua HTTP."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._pending: deque[Chunk] = deque()
        self._open: set[str] = set()  # đã xếp hàng, chưa có kết quả
        self._answers: queue.Queue[tuple[str, str | None, str | None]] = queue.Queue()
        self.closed = False

    def offer(self, chunks: list[Chunk]) -> None:
        with self._lock:
            self._pending.extend(chunks)
            self._open.update(c.id for c in chunks)

    def next(self) -> Chunk | None:
        with self._lock:
            return None if self.closed or not self._pending else self._pending.popleft()

    def answer(self, chunk_id: str, text: str | None, error: str | None) -> str:
        """'ok' | 'closed' | 'unknown' (không có hoặc đã trả lời)."""
        with self._lock:
            if self.closed:
                return "closed"
            if chunk_id not in self._open:
                return "unknown"
            self._open.discard(chunk_id)
            self._pending = deque(c for c in self._pending if c.id != chunk_id)
        self._answers.put((chunk_id, text, error))
        return "ok"

    def wait(self, timeout: float) -> tuple[str, str | None, str | None] | None:
        try:
            return self._answers.get(timeout=timeout)
        except queue.Empty:
            return None

    def close(self) -> None:
        with self._lock:
            self.closed = True
            self._pending.clear()
