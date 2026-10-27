import 'package:flutter/material.dart';

import '../services/auth_service.dart';
import '../widgets/primary_button.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final AuthService _auth = AuthService();
  final _email = TextEditingController();

  void _goHome() {
    Navigator.pushNamed(context, '/home');
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: PrimaryButton(
          label: 'Đăng nhập',
          onPressed: () => _auth.login(_email.text, 'secret').then((_) => _goHome()),
        ),
      ),
    );
  }
}
