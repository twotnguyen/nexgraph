"""Cổng duy nhất tới Graphify vendor (`engine/third_party/graphify`, v0.9.120 đóng băng, ADR 0026).

Mỗi module con là một nhóm năng lực; sửa hành vi thì sửa ở đây, không sửa mã vendor.
Luật `graphify-gateway` (import-linter) chặn import `graphify` ở nơi khác trong `nexgraph_engine`.
"""
