"""Fixture nhỏ (Python + TypeScript + test) cho bộ nạp graph.json."""


def greet(name: str) -> str:
    return f"Xin chào {name}"


def shout(name: str) -> str:
    return greet(name).upper()


class Greeter:
    def __init__(self, prefix: str = "Chào") -> None:
        self.prefix = prefix

    def hello(self, name: str) -> str:
        return f"{self.prefix} {name}"
