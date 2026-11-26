import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

# Script đo/đánh giá ở tools/ của repo (ADR 0026 pha 1), chạy trong môi trường uv của engine.
TOOLS = Path(__file__).resolve().parents[2] / "tools"
SCRIPTS = {"eval_score": TOOLS / "eval", "eval_sample": TOOLS / "eval", "bench_all": TOOLS / "bench"}


def load(name: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS[name] / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


HEADER = "file,kind,source,target,line\n"
# flow_app: 9 CALLS xuất phát từ app.py/service.py. Nhãn thiếu hash_password→hash_password (đồ thị dư: fp), thêm một nhãn
# login_user→delete_user mà đồ thị không có (fn).
LABELS = HEADER + """app.py,symbol,app.py::login,,
app.py,symbol,app.py::books,,
app.py,symbol,app.py::main,,
app.py,call,app.py::main,app.py::books,18
app.py,call,app.py::login,service.py::login_user,9
app.py,call,app.py::books,service.py::list_books,14
app.py,import,app.py,service.py,2
service.py,call,service.py::login_user,service.py::check_password,6
service.py,call,service.py::login_user,repo.py::find_user,5
service.py,call,service.py::login_user,repo.py::save_session,7
service.py,call,service.py::check_password,service.py::hash_password,11
service.py,call,service.py::list_books,repo.py::all_books,19
service.py,call,service.py::login_user,repo.py::delete_user,8
service.py,import,service.py,repo.py,1
service.py,test,service.py::login_user,test_service.py,
"""


def test_score_counts_and_precision_recall(index_project, fixtures_dir, tmp_path):
    ev = load("eval_score")
    store, _, _ = index_project(fixtures_dir / "flow_app")
    db = Path(store.conn.execute("PRAGMA database_list").fetchone()[2])
    labels_path = tmp_path / "labels.csv"
    labels_path.write_text(LABELS, encoding="utf-8")
    labels, files = ev.read_labels(labels_path), ev.label_files(labels_path)
    result, details = ev.score(labels, ev.db_facts(db, files))
    assert result["call"] == {"tp": 8, "fp": 1, "fn": 1, "precision": 0.889, "recall": 0.889}
    assert details["call"]["fp"] == [["service.py::hash_password", "service.py::hash_password", 15]]
    assert details["call"]["fn"] == [["service.py::login_user", "repo.py::delete_user", 8]]
    assert result["import"]["tp"] == 2 and result["import"]["fp"] == 0
    assert result["test"] == {"tp": 1, "fp": 0, "fn": 0, "precision": 1.0, "recall": 1.0}
    assert result["symbol"]["fn"] == 0
    assert result["symbol"]["fp"] == 5  # check_password, hash_password, list_books, unused_helper, login_user: chưa gán nhãn


def test_sample_is_deterministic_and_skips_tests(index_project, fixtures_dir, tmp_path):
    es = load("eval_sample")
    store, _, _ = index_project(fixtures_dir / "py_mini")
    db = Path(store.conn.execute("PRAGMA database_list").fetchone()[2])
    a, b = es.sample_files(db, 2, 7), es.sample_files(db, 2, 7)
    assert a == b and a == sorted(a)
    assert all(not f.startswith("test_") for f in a)


def test_bench_all_smoke(fixtures_dir, tmp_path):
    out = tmp_path / "perf.json"
    # PYTHONUTF8: script in tiếng Việt ra stdout; Windows mặc định cp1252 sẽ lỗi.
    r = subprocess.run([sys.executable, str(SCRIPTS["bench_all"] / "bench_all.py"), str(fixtures_dir / "flow_app"), "--repeat", "1", "--out", str(out)],
                       capture_output=True, text=True, encoding="utf-8", env={**os.environ, "PYTHONUTF8": "1"})
    assert r.returncode == 0, r.stderr
    data = json.loads(out.read_text(encoding="utf-8"))
    for key in ("index_full_ms", "reopen_ms", "refresh_one_file_ms", "rebuild_flows_ms", "build_map_400_ms", "import_cycles_ms",
                "build_tour_ms", "build_context_login_ms", "list_flows_auth_ms", "neighbors_top_node_ms", "graph_db_mb", "peak_rss_total_mb"):
        assert key in data["metrics"], key
    assert data["metrics"]["rebuild_flows_ms"]["n"] == 1
    # PERF-L mục 4: bảng NFR phải biết lần đo chạy với bao nhiêu worker và có rơi về tuần tự không.
    assert data["metrics"]["workers_effective"] >= 1
    assert data["metrics"]["fallback_serial"] in (True, False)
    assert isinstance(data["metrics"]["files_skipped"], int)
    assert data["nexgraph_commit"] and data["machine"]["os"]


def test_bench_all_imports_and_measures_without_the_unix_resource_module(monkeypatch):
    """Windows không có module `resource`; script phải nạp được và vẫn trả một số đo (hoặc None)."""
    import builtins

    real_import = builtins.__import__

    def fake_import(name, *args, **kwargs):
        if name == "resource":
            raise ImportError("No module named 'resource'")
        return real_import(name, *args, **kwargs)

    monkeypatch.setattr(builtins, "__import__", fake_import)
    mod = load("bench_all")
    assert mod.resource is None
    value = mod.peak_rss_mb()
    assert value is None or value > 0
