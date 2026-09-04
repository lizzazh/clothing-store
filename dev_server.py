import http.server
import socketserver
import json
import urllib.parse
import os

PORT = 8000

# Читаємо ключі з .dev.vars
env_vars = {}
try:
    with open(".dev.vars", "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, val = line.split("=", 1)
                env_vars[key.strip()] = val.strip()
except Exception as e:
    print(f"Попередження: не вдалося прочитати .dev.vars: {e}")

class CustomHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed_path = urllib.parse.urlparse(self.path)
        
        # Мокаємо Cloudflare Function для /api/key
        if parsed_path.path == "/api/key":
            self.send_response(200)
            self.send_header("Content-type", "application/json")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            response = json.dumps({
                "key": env_vars.get("GEMINI_API_KEY"),
                "openrouter_key": env_vars.get("OPENROUTER_API_KEY"),
                "groq_key": env_vars.get("GROQ_API_KEY")
            })
            self.wfile.write(response.encode("utf-8"))
            return
            
        # Для всіх інших шляхів використовуємо стандартну поведінку (роздаємо HTML/JS/CSS/статику)
        return super().do_GET()

# Додаємо підтримку правильних MIME-типів
CustomHandler.extensions_map.update({
    ".js": "application/javascript",
})

print(f"Запускаю локальний сервер на http://localhost:{PORT}")
print("Натисніть Ctrl+C для зупинки.")

with socketserver.TCPServer(("", PORT), CustomHandler) as httpd:
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nСервер зупинено.")
