"""Hợp đồng với bản Graphify vendor (ADR 0018, 0026): đúng commit đóng băng 0.9.120, đủ module."""
import importlib


def test_vendor_commit_is_frozen_0_9_120():
    from nexgraph_engine import VENDOR_COMMIT
    assert VENDOR_COMMIT == "16127eb30892f997d758efdd894e5e04264edbbb"


def test_vendor_has_expected_modules():
    for mod in ("graphify.sections", "graphify.cpp_resolution", "graphify.go_dispatch",
                "graphify.dfm_resolution", "graphify.extractors.yaml_config",
                "graphify.kotlin_dispatch"):  # kotlin_dispatch có từ 0.9.114
        importlib.import_module(mod)
