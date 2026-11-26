from app import Greeter, greet, shout


def test_greet() -> None:
    assert greet("Nex") == "Xin chào Nex"


def test_shout() -> None:
    assert shout("nex") == "XIN CHÀO NEX"


def test_greeter() -> None:
    assert Greeter().hello("Nex") == "Chào Nex"
