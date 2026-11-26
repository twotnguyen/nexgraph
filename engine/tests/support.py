"""Hàm dùng chung giữa các thư mục test (ADR 0026 pha 4d). `tests/` nằm trên sys.path nhờ conftest.py."""
import json

import anyio
from mcp.shared.memory import create_connected_server_and_client_session


def call(server, name: str, args: dict):
    """Gọi một tool MCP trên server trong bộ nhớ (trước ở test_mcp.py)."""
    async def run():
        async with create_connected_server_and_client_session(server._mcp_server) as client:
            return await client.call_tool(name, args)
    return anyio.run(run)


def payload(result):
    """Kết quả tool MCP → dữ liệu (trước ở test_mcp.py)."""
    assert result.isError is False, result.content[0].text
    sc = result.structuredContent  # list -> {"result": [...]}; dict không schema -> chỉ có content JSON
    if sc is None:
        return json.loads(result.content[0].text)
    return sc["result"] if set(sc) == {"result"} else sc


def make(tmp_path, spec, index_project):
    """Dựng dự án Python nhỏ theo spec {tệp: [module import]} rồi lập chỉ mục (trước ở test_arch_map.py)."""
    for rel, mods in spec.items():
        p = tmp_path / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("".join(f"import {m}\n" for m in mods) + "X = 1\n", encoding="utf-8")
    store, _, _ = index_project(tmp_path)
    return store
