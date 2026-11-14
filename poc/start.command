#!/bin/bash
# Double-click to launch the PRAHARI POC in your browser.
cd "$(dirname "$0")"
PORT=8080
while lsof -i :$PORT >/dev/null 2>&1; do PORT=$((PORT+1)); done
echo "Starting PRAHARI POC on http://localhost:$PORT  (close this window to stop)"
( sleep 1; open "http://localhost:$PORT" ) &
python3 -m http.server $PORT
