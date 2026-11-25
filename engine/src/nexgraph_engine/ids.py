"""Định danh nút (ADR 0005): `{rel_path}::{Qualified.Name}#{kind}`; nút tệp: `{rel_path}#file`."""
from nexgraph_engine.schema.enums import NodeKind

REPOSITORY_ID = f".#{NodeKind.REPOSITORY.value}"


def node_id(rel_path: str, qualified_name: str, kind: NodeKind) -> str:
    return f"{rel_path}::{qualified_name}#{kind.value}"


def file_node_id(rel_path: str) -> str:
    return f"{rel_path}#{NodeKind.FILE.value}"


def directory_node_id(rel_path: str) -> str:
    return f"{rel_path}#{NodeKind.DIRECTORY.value}"


# CI-1 probe engine: comment thử để đo CI chọn lọc; nhánh thử sẽ bị xoá.
