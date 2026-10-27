import 'package:flutter_test/flutter_test.dart';
import 'package:bookstore_app/services/auth_service.dart';

void main() {
  group('AuthService', () {
    test('login returns a user', () async {
      final user = await AuthService().login('a@b.c', 'pw');
      expect(user.name, 'a@b.c');
    });
  });
}
