#!/bin/bash
# SessionStart hook for Claude Code on the web: a session starts with the baseline working, so
# `pnpm test` and `pnpm test:e2e` measure the code and not the container.
#
# Each step is here because a session met its absence (see CLAUDE.md, "Never mistake a proxy for
# the thing"):
#   - Postgres is installed but stopped after a container restart, and the `throwpaper` role does
#     not exist in a fresh container. Without a database the api-sign envelope tests skip quietly
#     and e2e cannot start. DATABASE_URL is exported so an unreachable server fails those tests
#     rather than skipping them (apps/api-sign/src/test-database.ts).
#   - The container's Chromium can be an older build than the one @playwright/test asks for, and
#     `playwright install` must not be run here. A folder of links to the installed build, named
#     the way Playwright looks for it, stands in for the download.
# Idempotent and non-interactive: every step checks before it acts, and migrate and seed are
# safe to repeat.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

DATABASE_URL="${DATABASE_URL:-postgres://throwpaper:throwpaper@localhost:5432/throwpaper}"
export DATABASE_URL

persist() {
  if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
    echo "export $1=\"$2\"" >> "$CLAUDE_ENV_FILE"
  fi
}

# 1. Dependencies, exactly as the lockfile has them (CI installs the same way).
pnpm install --frozen-lockfile

# 2. Postgres: running, with the role and database CI's service container has.
if command -v pg_isready > /dev/null; then
  if ! pg_isready -q; then
    service postgresql start
    for _ in $(seq 1 30); do
      pg_isready -q && break
      sleep 1
    done
  fi
  if pg_isready -q; then
    as_postgres() { su postgres -c "psql -v ON_ERROR_STOP=1 -tAc \"$1\""; }
    if [ "$(as_postgres "SELECT 1 FROM pg_roles WHERE rolname = 'throwpaper'")" != "1" ]; then
      as_postgres "CREATE ROLE throwpaper LOGIN SUPERUSER PASSWORD 'throwpaper'"
    fi
    if [ "$(as_postgres "SELECT 1 FROM pg_database WHERE datname = 'throwpaper'")" != "1" ]; then
      as_postgres "CREATE DATABASE throwpaper OWNER throwpaper"
    fi
    pnpm db:migrate
    pnpm db:seed
    persist DATABASE_URL "$DATABASE_URL"
  else
    echo "session-start: Postgres did not start; database tests will fail, not skip" >&2
  fi
else
  echo "session-start: no Postgres in this container; database tests will fail, not skip" >&2
fi

# 3. Chromium under the build number @playwright/test asks for.
INSTALLED="${PLAYWRIGHT_BROWSERS_PATH:-/opt/pw-browsers}"
# playwright-core's `exports` hide browsers.json, so it is found beside the package's entry point.
BROWSERS_JSON=$(node -e "
const path = require('path');
const test = path.dirname(require.resolve('@playwright/test'));
process.stdout.write(path.join(path.dirname(require.resolve('playwright-core', { paths: [test] })), 'browsers.json'));
")
wanted() {
  node -e "const b = require(process.argv[1]).browsers.find((x) => x.name === process.argv[2]); process.stdout.write(b ? b.revision : '')" "$BROWSERS_JSON" "$1"
}
CHROMIUM=$(wanted chromium)
SHELL_REV=$(wanted chromium-headless-shell)
FFMPEG=$(wanted ffmpeg)

if [ -f "$INSTALLED/chromium_headless_shell-$SHELL_REV/INSTALLATION_COMPLETE" ]; then
  echo "session-start: Chromium $SHELL_REV is installed"
else
  newest() { find "$INSTALLED" -maxdepth 1 -type d -name "$1-[0-9]*" | sort -t- -k2 -n | tail -1; }
  HAVE_CHROMIUM=$(newest chromium)
  HAVE_SHELL=$(newest chromium_headless_shell)
  if [ -z "$HAVE_CHROMIUM" ] || [ -z "$HAVE_SHELL" ]; then
    echo "session-start: no Chromium in $INSTALLED; browser tests cannot launch" >&2
  else
    first() { for path in "$@"; do [ -x "$path" ] && { echo "$path"; return; }; done; }
    CHROME=$(first "$HAVE_CHROMIUM/chrome-linux64/chrome" "$HAVE_CHROMIUM/chrome-linux/chrome")
    HEADLESS=$(first "$HAVE_SHELL/chrome-headless-shell-linux64/chrome-headless-shell" \
      "$HAVE_SHELL/chrome-linux/headless_shell")
    SHIM="$HOME/.cache/throwpaper-playwright"
    rm -rf "$SHIM"
    mkdir -p "$SHIM/chromium-$CHROMIUM/chrome-linux64" \
      "$SHIM/chromium_headless_shell-$SHELL_REV/chrome-headless-shell-linux64"
    ln -sfn "$CHROME" "$SHIM/chromium-$CHROMIUM/chrome-linux64/chrome"
    ln -sfn "$HEADLESS" \
      "$SHIM/chromium_headless_shell-$SHELL_REV/chrome-headless-shell-linux64/chrome-headless-shell"
    for dir in "chromium-$CHROMIUM" "chromium_headless_shell-$SHELL_REV"; do
      touch "$SHIM/$dir/INSTALLATION_COMPLETE" "$SHIM/$dir/DEPENDENCIES_VALIDATED"
    done
    if [ -n "$FFMPEG" ] && [ -d "$INSTALLED/ffmpeg-$FFMPEG" ]; then
      ln -sfn "$INSTALLED/ffmpeg-$FFMPEG" "$SHIM/ffmpeg-$FFMPEG"
    fi
    persist PLAYWRIGHT_BROWSERS_PATH "$SHIM"
    echo "session-start: Chromium $SHELL_REV is linked to $(basename "$HAVE_SHELL") in $SHIM"
  fi
fi
