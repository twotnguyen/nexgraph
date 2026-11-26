import pytest

from nexgraph_engine.text.keywords import search_keywords, split_identifier


@pytest.mark.parametrize("name,expected", [
    ("LoginScreen", ["login", "screen"]),
    ("HTTPServer", ["http", "server"]),
    ("_authService", ["auth", "service"]),
    ("parse_json2Dart", ["parse", "json", "2", "dart"]),
    ("snake_case_name", ["snake", "case", "name"]),
    ("kebab-case", ["kebab", "case"]),
    ("đăng_nhậpScreen", ["đăng", "nhập", "screen"]),
    ("x", ["x"]),
    ("", []),
    ("___", []),
    ("login_screen.dart", ["login", "screen", "dart"]),
    ("lib/services/auth_service.dart", ["lib", "services", "auth", "service", "dart"]),
])
def test_split_identifier(name, expected):
    assert split_identifier(name) == expected


def test_search_keywords_dedups_and_joins():
    kw = search_keywords("LoginScreen", "lib/a.dart::LoginScreen")
    words = kw.split()
    assert words.count("login") == 1 and words.count("screen") == 1 and "lib" in words
