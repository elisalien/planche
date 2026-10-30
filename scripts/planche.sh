#!/bin/sh
# Planche launcher: starts the local server (if needed) and opens the browser.
cd "$(dirname "$0")" || exit 1
PORT="${PORT:-8787}"
URL="http://localhost:$PORT"
open_url() {
  if command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1
  elif command -v open >/dev/null 2>&1; then open "$URL"
  else echo "Ouvrez $URL"
  fi
}
if curl -fsS --max-time 1 "$URL/api/health" >/dev/null 2>&1; then open_url; exit 0; fi
(sleep 2; open_url) &
exec node server/server.mjs
