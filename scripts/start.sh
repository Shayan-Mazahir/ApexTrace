#!/usr/bin/env bash
# Starts the backend (:8000) and the frontend (:5173), both reachable on the LAN
# so a second device can open the Engineer screen. Ctrl+C stops both.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [ ! -d "$ROOT/backend/venv" ]; then
  echo "No backend/venv yet. Run: cd backend && python3.11 -m venv venv && source venv/bin/activate && pip install -r requirements.txt" >&2
  exit 1
fi
if [ ! -d "$ROOT/frontend/node_modules" ]; then
  echo "No frontend/node_modules yet. Run: cd frontend && npm install" >&2
  exit 1
fi

LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || true)"

(cd "$ROOT/backend" && source venv/bin/activate && exec uvicorn app.main:app --host 0.0.0.0 --port 8000) &
BACKEND=$!
(cd "$ROOT/frontend" && exec npm run dev -- --host --port 5173) &
FRONTEND=$!
trap 'kill $BACKEND $FRONTEND 2>/dev/null || true' EXIT INT TERM

echo
echo "Driver laptop : http://localhost:5173/#drive"
[ -n "$LAN_IP" ] && echo "Engineer device: http://$LAN_IP:5173/#engineer   (same Wi-Fi; paste the Session ID)"
echo "Ctrl+C to stop."
wait
