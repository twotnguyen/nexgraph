"""Hợp đồng với bản Graphify vendor (W1, ADR 0018): đúng commit, đủ module của 0.9.112."""
import importlib


def test_vendor_commit_is_0_9_112():
    from nexgraph_engine import VENDOR_COMMIT
    assert VENDOR_COMMIT == "c60eea01cf87dcfb33787808cd534cc7afc5ffff"


def test_vendor_has_0_9_112_modules():
    for mod in ("graphify.sections", "graphify.cpp_resolution", "graphify.go_dispatch",
                "graphify.dfm_resolution", "graphify.extractors.yaml_config"):
        importlib.import_module(mod)
