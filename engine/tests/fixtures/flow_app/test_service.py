from service import login_user


def test_login():
    assert login_user(1) == 1
