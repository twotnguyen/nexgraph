import 'package:go_router/go_router.dart';

import 'screens/login_screen.dart';

final router = GoRouter(routes: [
  GoRoute(path: '/login', builder: (context, state) => const LoginScreen()),
]);

String initialLocation() => '/login';
