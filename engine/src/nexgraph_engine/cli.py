"""Điểm vào công khai của engine: `python -m nexgraph_engine.cli`, script `nexgraph-engine`, tệp vào của PyInstaller.

Tên này là hợp đồng với bên ngoài nên giữ nguyên khi chia tầng (ADR 0026 pha 4c). Desktop gọi nó ở chế độ chạy
từ mã nguồn; hook git và cấu hình MCP đã ghi vào máy người dùng cũng gọi nó. Mã nằm ở `interfaces/cli.py`. Module
này không import gì thêm, để `hook-guard` vẫn khởi động nhanh.
"""
from nexgraph_engine.interfaces.cli import main

__all__ = ["main"]

if __name__ == "__main__":
    raise SystemExit(main())
