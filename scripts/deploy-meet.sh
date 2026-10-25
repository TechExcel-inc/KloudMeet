#!/usr/bin/env bash
# Deploys origin/main to https://meet.kloud.cn. The Windows server builds it itself with
# C:\inetpub\deploy-kloudmeet.ps1: each build is a release under C:\inetpub\KloudMeet-releases, and the
# C:\inetpub\KloudMeet-current junction (what PM2's sky-meet and funasr-relay run) points at the live one.
#
#   npm run deploy               build origin/main on the server, then switch the site to it and check it
#   npm run deploy -- --dry-run  show what would be deployed and what is live; changes nothing
#   npm run deploy -- --switch   switch to the newest release without building (after running migrations)
#
# Push first: the server pulls origin/main, not this computer's files. A build that brings new
# prisma/*.sql migrations stops before the switch; run them on the database, then use --switch.
# Rollback, on the server: powershell -File C:\inetpub\deploy-kloudmeet.ps1 rollback
#
# The server password is read from the macOS Keychain, so it never appears in commands, logs or an AI
# conversation. Add it once (it asks for the password):
#   security add-generic-password -s kloudmeet-deploy -a administrator -w
set -euo pipefail

HOST=74.208.27.19
PORT=10022
LOGIN=administrator
PS1='C:\inetpub\deploy-kloudmeet.ps1'
RELEASES='C:\inetpub\KloudMeet-releases'
SITE=https://meet.kloud.cn
LOG=/tmp/kloudmeet-build.log

dry=0
build=1
for arg in "$@"; do
  case "$arg" in
    --dry-run) dry=1 ;;
    --switch) build=0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")/.."
step() { echo "==> $*"; }

git fetch -q origin main
target=$(git rev-parse --short origin/main)
if [[ -n "$(git log --oneline origin/main..HEAD)" ]]; then
  echo "This branch has commits that are not on origin/main. Push them first; the server builds origin/main ($target)." >&2
  exit 1
fi
git diff --quiet HEAD -- . ':!docs' 2>/dev/null || echo "    Note: uncommitted changes here are not deployed."

if ! SSHPASS=$(security find-generic-password -s kloudmeet-deploy -a "$LOGIN" -w 2>/dev/null); then
  echo "The server password is not in the Keychain. Add it once with:" >&2
  echo "  security add-generic-password -s kloudmeet-deploy -a $LOGIN -w" >&2
  exit 1
fi
export SSHPASS
opts=(-o StrictHostKeyChecking=accept-new -o PreferredAuthentications=password -o PubkeyAuthentication=no -o LogLevel=ERROR -o ConnectTimeout=20 -o ServerAliveInterval=30)
remote() { sshpass -e ssh -p "$PORT" "${opts[@]}" "$LOGIN@$HOST" "$1" | tr -d '\r'; }
release_script() { remote "powershell -NoProfile -ExecutionPolicy Bypass -File $PS1 $*"; }
build_id() { remote "type $RELEASES\\$1\\.next\\BUILD_ID" | tr -d '\n'; }

status=$(release_script status)
live=$(sed -n 's/^Live: *//p' <<< "$status")
step "Live: ${live:-none}; origin/main: $target ($(git log -1 --format=%s origin/main))"
if [[ "$live" == *"-$target" ]]; then
  echo "origin/main is already live."
  exit 0
fi
if [[ $dry == 1 ]]; then
  step "Dry run: would $([[ $build == 1 ]] && echo "build $target on the server, then ")switch the site to it"
  exit 0
fi

if [[ $build == 1 ]]; then
  step "Building $target on the server (the site keeps running; this takes a few minutes)"
  if ! release_script build > "$LOG" 2>&1; then
    tail -40 "$LOG"
    echo "Server build failed; the live site was not changed. Full log: $LOG" >&2
    exit 1
  fi
  release=$(sed -n 's/^Built release //p' "$LOG" | tail -1)
  [[ -n "$release" ]] || { tail -20 "$LOG"; echo "The build did not report a release name. Full log: $LOG" >&2; exit 1; }
  echo "    Built $release"
  if grep -q '^New database migrations' "$LOG"; then
    sed -n '/^New database migrations/,/^Next:/p' "$LOG" | grep -v '^Next:'
    echo "Not switched: run these migrations on the database first, then: npm run deploy -- --switch" >&2
    exit 1
  fi
else
  release=$(release_script status | sed -n 's/^  \([0-9]\{8\}-[0-9]\{4\}-[0-9a-f]*\)$/\1/p' | tail -1)
  [[ "$release" == *"-$target" ]] || { echo "The newest release is ${release:-none}, not origin/main ($target). Run without --switch to build it." >&2; exit 1; }
fi

expected=$(build_id "$release")
[[ -n "$expected" ]] || { echo "Could not read the BUILD_ID of $release." >&2; exit 1; }

step "Switching the site to $release"
release_script "switch -Release $release" | sed 's/^/    /'

# The HTML names its build, and one of its scripts must load: a 200 alone can come from the old release.
step "Checking $SITE serves $release"
page=
for _ in $(seq 1 30); do
  page=$(curl -s -m 10 "$SITE" || true)
  grep -qF "$expected" <<< "$page" && break
  sleep 2
done
chunk=$(grep -o '/_next/static/chunks/[^"]*\.js' <<< "$page" | head -1 || true)
asset=$([[ -n "$chunk" ]] && curl -s -o /dev/null -w '%{http_code}' -m 10 "$SITE$chunk" || echo none)
if grep -qF "$expected" <<< "$page" && [[ "$asset" == 200 ]]; then
  echo "Deployed: $SITE serves $release (build $expected, scripts $asset)."
else
  echo "Switched, but $SITE does not serve build $expected (scripts $asset)." >&2
  echo "Check: npx pm2 logs sky-meet. Roll back on the server with: powershell -File $PS1 rollback" >&2
  exit 1
fi
