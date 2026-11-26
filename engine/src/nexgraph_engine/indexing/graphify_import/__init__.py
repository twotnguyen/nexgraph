"""Nạp `graph.json` của Graphify vào `graph.db` (ADR 0023, đợt N1-E1)."""
from nexgraph_engine.indexing.graphify_import.enrich import EnrichReport, enrich_missing_fields
from nexgraph_engine.indexing.graphify_import.importer import (
    ImportReport,
    ParsedGraph,
    import_graph_json,
    parse_graph,
)
from nexgraph_engine.indexing.graphify_import.incremental import (
    ReplaceReport,
    changed_files_from_manifest,
    replace_files,
)
from nexgraph_engine.indexing.graphify_import.mapping import EXTERNAL_FILE, RELATION

__all__ = [
    "EXTERNAL_FILE", "RELATION", "EnrichReport", "ImportReport", "ParsedGraph", "ReplaceReport",
    "changed_files_from_manifest", "enrich_missing_fields", "import_graph_json", "parse_graph",
    "replace_files",
]
