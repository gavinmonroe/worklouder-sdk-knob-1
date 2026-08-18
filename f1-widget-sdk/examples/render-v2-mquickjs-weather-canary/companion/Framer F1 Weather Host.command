#!/bin/zsh

set -euo pipefail

COMPANION_ROOT="${0:A:h}"
INPUT_APP="/Applications/input.app"

pause_on_error() {
  echo
  read "?Press Return to close this window."
}

trap pause_on_error ERR

if /usr/bin/pgrep -f run-live-media >/dev/null 2>&1; then
  echo "The Framer F1 Music Host (run-live-media) appears to be running."
  echo "It shares the keyboard's RPC transport with this Weather Host."
  echo "Quit the Music Host, then run this launcher again."
  exit 1
fi

if [[ ! -d "$INPUT_APP" ]]; then
  echo "Work Louder Input was not found in /Applications."
  echo "Install Input, then run this launcher again."
  exit 1
fi

NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "Node.js 22 or newer is required."
  echo "Install the current LTS release from https://nodejs.org, then run this launcher again."
  exit 1
fi

NODE_MAJOR="$($NODE_BIN -p 'Number(process.versions.node.split(".")[0])')"
if [[ "$NODE_MAJOR" -lt 22 ]]; then
  echo "Node.js 22 or newer is required; found $($NODE_BIN --version)."
  exit 1
fi

debugger_ready() {
  /usr/bin/curl --silent --fail --max-time 1 http://127.0.0.1:9230/json/list >/dev/null 2>&1
}

if ! debugger_ready; then
  if /usr/bin/pgrep -x input >/dev/null 2>&1; then
    echo "Work Louder Input is already running without remote debugging enabled."
    echo "Quit Input completely, then run this launcher again."
    exit 1
  fi

  echo "Starting Work Louder Input with its local debugger…"
  /usr/bin/open -n -a input --args --inspect=9230
  for _attempt in {1..40}; do
    debugger_ready && break
    /bin/sleep 0.25
  done
fi

if ! debugger_ready; then
  echo "Input did not open its local bridge on port 9230."
  exit 1
fi

echo "Pushing the clock + timer package, then starting Framer F1 Weather sync."
echo "Keep this window open. The keyboard must remain connected by USB. Press Control-C to stop."
echo
exec "$NODE_BIN" "$COMPANION_ROOT/runtime/f1-widget-sdk/examples/render-v2-mquickjs-weather-canary/companion/run-weather-host.mjs"
