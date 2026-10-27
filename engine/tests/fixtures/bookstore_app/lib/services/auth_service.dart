import '../models/user.dart';
import 'api_client.dart';

class AuthService {
  final ApiClient _api;

  AuthService([ApiClient? api]) : _api = api ?? ApiClient('https://example.test');

  Future<User> login(String email, String password) async {
    await _api.post('/auth/csrf', {});
    final data = await _api.post('/auth/login', {'email': email, 'password': password});
    return User(id: data['id'] as String, name: email);
  }
}
