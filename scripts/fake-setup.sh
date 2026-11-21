#!/usr/bin/env bash
# Sets up everything to try LiftOff by hand with no real Jira or GitLab (see docs/fake-jira.md):
#   - a fake Jira Data Center in Docker, on https://127.0.0.1:8443, project PROJ, token agent-run-PAT-do-not-leak
#   - a small project with a git history and a bare remote to push to, in <sandbox>/my-app
#   - the exact command that starts Claude Code with the plugin and the fakes
# An older sandbox is moved aside (never deleted). Nothing outside the sandbox folder and the Docker container is touched.
# Usage: scripts/fake-setup.sh [--down]      SANDBOX=<folder> to use another place than ~/liftoff-sandbox
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
SANDBOX="${SANDBOX:-$HOME/liftoff-sandbox}"
NAME=lo-fake-jira
TOKEN=agent-run-PAT-do-not-leak

if [ "${1:-}" = "--down" ]; then
  docker rm -f "$NAME" >/dev/null 2>&1 && echo "Stopped the fake Jira." || echo "The fake Jira was not running."
  exit 0
fi

command -v docker >/dev/null || { echo "Docker is not installed." >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "Docker is not running: start it and run this again." >&2; exit 1; }
command -v node >/dev/null || { echo "Node 22.12 or newer is needed." >&2; exit 1; }
command -v git >/dev/null || { echo "git is needed." >&2; exit 1; }

echo "1/5 Building the plugin..."
cd "$REPO"
[ -d node_modules ] || npm ci --silent
npm run build --silent >/dev/null

echo "2/5 Starting from a clean place..."
docker rm -f "$NAME" >/dev/null 2>&1 || true
if [ -e "$SANDBOX" ]; then
  OLD="$SANDBOX.old-$(date +%Y%m%d-%H%M%S)"
  mv "$SANDBOX" "$OLD"
  echo "    the previous sandbox is now $OLD"
fi
mkdir -p "$SANDBOX"

echo "3/5 Starting the fake Jira (the first build takes a minute)..."
docker build -q -f "$REPO/Dockerfile.fake-jira" -t liftoff-fake-jira "$REPO" >/dev/null
docker run -d --name "$NAME" --user "$(id -u):$(id -g)" -p 127.0.0.1:8443:8443 -v "$SANDBOX":/sandbox liftoff-fake-jira >/dev/null \
  || { echo "Could not start it: is something else using port 8443?" >&2; exit 1; }
for _ in $(seq 1 40); do
  [ "$(curl -sk -o /dev/null -w '%{http_code}' https://127.0.0.1:8443/rest/api/2/serverInfo 2>/dev/null || true)" = "401" ] && break
  sleep 0.5
done
[ "$(curl -sk -o /dev/null -w '%{http_code}' https://127.0.0.1:8443/rest/api/2/serverInfo 2>/dev/null || true)" = "401" ] \
  || { echo "The fake Jira did not answer. See: docker logs $NAME" >&2; exit 1; }

echo "4/5 Creating the project and its remote..."
APP="$SANDBOX/my-app"
git init -q -b main --bare "$SANDBOX/remote.git"
git init -q -b main "$APP"
(
  cd "$APP"
  git config user.email you@example.com
  git config user.name "The Product Owner"
  git remote add origin "$SANDBOX/remote.git"
  mkdir backend frontend
  echo '{"name":"api","scripts":{"build":"tsc","test":"vitest"},"devDependencies":{"typescript":"5"}}' > backend/package.json
  echo '{"name":"web","dependencies":{"react":"19"}}' > frontend/package.json
  echo "# my app" > README.md
  git add -A
  git commit -qm "init"
  git push -q -u origin main
)

echo "5/5 Ready."
cat <<EOF

  The fake Jira:  https://127.0.0.1:8443      project PROJ      token  $TOKEN
  Your project:   $APP

  Start Claude Code like this (in a terminal of your own):

    cd "$APP"
    export FAKE_KEYCHAIN_FILE="$SANDBOX/keychain"
    PATH="$REPO/test/e2e/fakes:\$PATH" claude --plugin-dir "$REPO/plugin"

  Then say what you want, for example: "I want to set up liftoff for this project".
  When you are done:  $0 --down
EOF
