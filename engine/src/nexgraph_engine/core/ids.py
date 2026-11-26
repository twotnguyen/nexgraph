"""Định danh nút (ADR 0005): `{rel_path}::{Qualified.Name}#{kind}`; nút tệp: `{rel_path}#file`."""
import hashlib

from nexgraph_engine.core.schema.enums import NodeKind

REPOSITORY_ID = f".#{NodeKind.REPOSITORY.value}"


def node_id(rel_path: str, qualified_name: str, kind: NodeKind) -> str:
    return f"{rel_path}::{qualified_name}#{kind.value}"


def file_node_id(rel_path: str) -> str:
    return f"{rel_path}#{NodeKind.FILE.value}"


def directory_node_id(rel_path: str) -> str:
    return f"{rel_path}#{NodeKind.DIRECTORY.value}"


def membership_signature(files: list[str]) -> str:
    """Chữ ký thành viên của một cụm (như `.graphify_labels.json.sig`): SHA256 danh sách tệp đã sắp xếp."""
    return hashlib.sha256("\n".join(sorted(files)).encode("utf-8")).hexdigest()
