"""Enum của đồ thị. Giá trị phải khớp đúng các mệnh đề CHECK trong schema/graph.sql (có test kiểm)."""
from enum import StrEnum


class NodeKind(StrEnum):
    REPOSITORY = "repository"
    PACKAGE = "package"
    DIRECTORY = "directory"
    FILE = "file"
    MODULE = "module"
    CLASS = "class"
    MIXIN = "mixin"
    ENUM = "enum"
    EXTENSION = "extension"
    FUNCTION = "function"
    METHOD = "method"
    TEST = "test"
    WIDGET = "widget"
    SCREEN = "screen"
    ROUTE = "route"
    DOCUMENT = "document"
    CONCEPT = "concept"
    TYPE = "type"  # W2: struct/trait/interface... của ngôn ngữ mức chung
    VARIABLE = "variable"
    TABLE = "table"
    RESOURCE = "resource"
    CONFIG_KEY = "config_key"


class EdgeType(StrEnum):
    CONTAINS = "CONTAINS"
    DEFINES = "DEFINES"
    CALLS = "CALLS"
    IMPORTS = "IMPORTS"
    INHERITS = "INHERITS"
    IMPLEMENTS = "IMPLEMENTS"
    REFERENCES = "REFERENCES"
    USES_TYPE = "USES_TYPE"
    TESTED_BY = "TESTED_BY"
    DOCUMENTS = "DOCUMENTS"
    DEPENDS_ON = "DEPENDS_ON"
    SEMANTIC_RELATED = "SEMANTIC_RELATED"
    COMPOSES = "COMPOSES"
    NAVIGATES_TO = "NAVIGATES_TO"


class Confidence(StrEnum):
    EXTRACTED = "EXTRACTED"
    INFERRED = "INFERRED"
    AMBIGUOUS = "AMBIGUOUS"


class Origin(StrEnum):
    AST = "ast"
    RESOLVER = "resolver"
    LLM = "llm"
