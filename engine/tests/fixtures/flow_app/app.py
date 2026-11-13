from fastapi import FastAPI
from service import login_user, list_books

app = FastAPI()


@app.post("/auth/login")
def login(body):
    return login_user(body)


@app.get("/books")
def books():
    return list_books()


def main():
    return books()
