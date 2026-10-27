class ApiClient {
  final String baseUrl;

  ApiClient(this.baseUrl);

  Future<Map<String, dynamic>> post(String path, Map<String, dynamic> body) async {
    return {'path': path, ...body};
  }
}
