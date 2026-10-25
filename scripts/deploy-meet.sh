#!/usr/bin/env bash
# Deploys KloudMeet to https://meet.kloud.cn: the Windows server runs .next/standalone under PM2
# (ecosystem.config.js: sky-meet and funasr-relay) from C:\inetpub\KloudMeet.
#
#   npm run deploy               build, upload, swap and restart, then check the site
#   npm run deploy -- --dry-run  build and pack only; print the server steps without connecting
#   npm run deploy -- --no-build reuse the last build in .next/standalone
#
# The server password is read from the macOS Keychain, so it never appears in commands, logs or an AI
# conversation. Add it once (it asks for the password):
#   security add-generic-password -s kloudmeet-deploy -a administrator -w
set -euo pipefail

HOST=74.208.27.19
PORT=10022
LOGIN=administrator
REMOTE='C:\inetpub\KloudMeet'
SITE=https://meet.kloud.cn
TARBALL=/tmp/kloudmeet-deploy.tar.gz

dry=0
build=1
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry=1 ;;
    --no-build) build=0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")/.."
step() { echo "==> $*"; }

if [[ $build == 1 ]]; then
  step "Building $(git rev-parse --short HEAD)$(git diff --quiet HEAD -- . ':!docs' 2>/dev/null || echo ' plus uncommitted changes')"
  if ! npm run build:deploy > /tmp/kloudmeet-build.log 2>&1; then
    tail -40 /tmp/kloudmeet-build.log
    echo "Build failed; nothing was uploaded. Full log: /tmp/kloudmeet-build.log" >&2
    exit 1
  fi
fi
[[ -f .next/standalone/server.js ]] || { echo "No build in .next/standalone. Run without --no-build." >&2; exit 1; }

# This computer's .env files stay here: the server keeps its own .env.local.
step "Packing .next/standalone"
tar czf "$TARBALL" --exclude ./.env.local --exclude ./.env.production -C .next/standalone .
echo "    $(du -h "$TARBALL" | cut -f1)"

# One short command per connection: long chains on this server have dropped the connection.
steps=(
  "cd /d $REMOTE && npx pm2 stop ecosystem.config.js"
  "ping -n 3 127.0.0.1 >nul & if exist $REMOTE\\.next\\standalone rmdir /s /q $REMOTE\\.next\\standalone"
  "mkdir $REMOTE\\.next\\standalone && cd /d $REMOTE\\.next\\standalone && tar xzf C:\\inetpub\\kloudmeet-deploy.tar.gz && copy /y $REMOTE\\.env.local .env.local >nul"
  "cd /d $REMOTE && npx pm2 start ecosystem.config.js && npx pm2 save"
)

if [[ $dry == 1 ]]; then
  step "Dry run: would upload $TARBALL to C:/inetpub/ on $HOST:$PORT and run:"
  printf '    %s\n' "${steps[@]}"
  exit 0
fi

if ! SSHPASS=$(security find-generic-password -s kloudmeet-deploy -a "$LOGIN" -w 2>/dev/null); then
  echo "The server password is not in the Keychain. Add it once with:" >&2
  echo "  security add-generic-password -s kloudmeet-deploy -a $LOGIN -w" >&2
  exit 1
fi
export SSHPASS
opts=(-o StrictHostKeyChecking=accept-new -o PreferredAuthentications=password -o PubkeyAuthentication=no -o LogLevel=ERROR -o ConnectTimeout=20)
remote() { sshpass -e ssh -p "$PORT" "${opts[@]}" "$LOGIN@$HOST" "$1"; }

step "Uploading"
sshpass -e scp -P "$PORT" "${opts[@]}" "$TARBALL" "$LOGIN@$HOST:C:/inetpub/kloudmeet-deploy.tar.gz"

step "Stopping the site"
remote "${steps[0]}" > /dev/null || echo "    (it was not running)"
step "Replacing .next\\standalone"
remote "${steps[1]}"
remote "${steps[2]}"
step "Starting the site"
remote "${steps[3]}" > /dev/null

# The page and one of its scripts: a missing .next/static folder answers 200 for the page but 404 for scripts.
step "Checking $SITE"
for _ in $(seq 1 30); do
  page=$(curl -s -m 10 "$SITE" || true)
  [[ -n "$page" ]] && break
  sleep 2
done
chunk=$(grep -o '/_next/static/chunks/[^"]*\.js' <<< "$page" | head -1 || true)
code=$(curl -s -o /dev/null -w '%{http_code}' -m 10 "$SITE")
asset=$([[ -n "$chunk" ]] && curl -s -o /dev/null -w '%{http_code}' -m 10 "$SITE$chunk" || echo none)
if [[ "$code" == 200 && "$asset" == 200 ]]; then
  echo "Deployed: $SITE answers (page $code, scripts $asset)."
else
  echo "Deployed, but the site does not look right: page $code, scripts $asset. Check: npx pm2 logs sky-meet" >&2
  exit 1
fi
