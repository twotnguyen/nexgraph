import os
from util import helper


class App:
    def run(self):
        return self.step()

    def step(self):
        return helper(1)


def local():
    return other()


def other():
    return os.getcwd()


def start():
    return App().run()
