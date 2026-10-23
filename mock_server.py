"""Mock prediction backend for testing the frontend without the real ML model.

Run:  python mock_server.py       (listens on http://localhost:8000/predict)

POST /predict  {"region": "NA1", "tier": "EMERALD", "blue": [5 champion ids], "red": [5 champion ids]}
  ->  {"blue_win_rate": 0.53, "red_win_rate": 0.47}
"""
import hashlib
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self):
        if self.path != "/predict":
            self.send_error(404)
            return
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        blue, red = body.get("blue", []), body.get("red", [])
        if len(blue) != 5 or len(red) != 5:
            self._json(400, {"error": "blue and red must each contain 5 champions"})
            return
        region, tier = body.get("region"), body.get("tier")
        if not region or not tier:
            self._json(400, {"error": "region and tier are required"})
            return
        # Deterministic pseudo-prediction so the same draft/region/tier gives the same answer.
        h = int(hashlib.sha256(json.dumps([region, tier, blue, red]).encode()).hexdigest(), 16)
        p = 0.35 + (h % 3000) / 10000  # 0.35 .. 0.65
        self._json(200, {"blue_win_rate": round(p, 4), "red_win_rate": round(1 - p, 4)})

    def _json(self, code, obj):
        data = json.dumps(obj).encode()
        self.send_response(code)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


if __name__ == "__main__":
    print("Mock backend on http://localhost:8000/predict")
    ThreadingHTTPServer(("localhost", 8000), Handler).serve_forever()
