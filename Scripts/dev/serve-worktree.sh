#!/usr/bin/env bash
#
# Start or stop the web app for the current checkout or worktree on its own port.
#
# Usage:
#   Scripts/dev/serve-worktree.sh start   start `npm run dev:webpack` on the first free port from 3100
#   Scripts/dev/serve-worktree.sh stop    stop the server this checkout started
#
# Webpack, not Turbopack: worktrees share the main checkout's node_modules through a symlink, which
# Turbopack rejects. The server runs with development sign-in switched on; it uses whatever
# DATABASE_URL the caller exports (see Scripts/dev/scratch-db.sh), or the checkout's .env.
# The PID and port live in tmp/serve-worktree.pid and the log in tmp/serve-worktree.log, so `stop`
# kills only this checkout's server, never another worktree's.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
pid_file="tmp/serve-worktree.pid"
log_file="tmp/serve-worktree.log"
timeout_seconds="${SERVE_WORKTREE_TIMEOUT:-90}"

usage() {
  echo "Usage: Scripts/dev/serve-worktree.sh start|stop" >&2
  exit 2
}

# Prints "<pid> <port>" when this checkout's server is still running.
running_server() {
  [[ -f "$pid_file" ]] || return 1
  local pid port
  read -r pid port <"$pid_file"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  # The server runs in its own process group whose id is the launcher's PID. Check the group, not
  # the launcher alone, so an orphaned next-server is still found, and require a Next process in it
  # so an unrelated group is never matched.
  pgrep -g "$pid" -f "dev:webpack|next dev|next-server" >/dev/null || return 1
  echo "$pid $port"
}

print_access() {
  echo "serve-worktree: $1 at http://localhost:$2"
  echo "serve-worktree: sign in as admin@statly.dev; the password is described in"
  echo "  docs/development/setup.md (Serving a worktree) and src/lib/devAuth.ts"
  echo "serve-worktree: log: $log_file   stop: npm run dev:serve -- stop"
}

start() {
  local existing
  if existing="$(running_server)"; then
    print_access "already running" "${existing#* }"
    return 0
  fi

  local port=3100
  while nc -z 127.0.0.1 "$port" >/dev/null 2>&1; do
    port=$((port + 1))
    if ((port > 3199)); then
      echo "serve-worktree: no free port in 3100-3199" >&2
      exit 1
    fi
  done

  if [[ -z "${DATABASE_URL:-}" ]]; then
    echo "serve-worktree: DATABASE_URL is not exported; database pages use this checkout's .env," >&2
    echo "  or fail without one. For a throwaway database: eval \"\$(npm run -s db:scratch -- up <name>)\"" >&2
  elif [[ -z "${DIRECT_DATABASE_URL:-}" ]]; then
    export DIRECT_DATABASE_URL="$DATABASE_URL"
  fi

  # next dev rewrites these two tracked files on start; put them back once it is up, unless the
  # caller already had changes in them.
  local generated_files=(AGENTS.md next-env.d.ts) restore_generated=false
  git diff --quiet HEAD -- "${generated_files[@]}" && restore_generated=true

  mkdir -p tmp
  local url="http://localhost:$port" pid launches=0
  # ipv4first: where IPv6 is unreachable, Google Fonts downloads otherwise stall the first compile.
  local node_options="${NODE_OPTIONS:+$NODE_OPTIONS }--dns-result-order=ipv4first"
  launch() {
    launches=$((launches + 1))
    # Job control gives the server its own process group, so `stop` ends npm, next and its workers.
    set -m
    PORT="$port" APP_BASE_URL="$url" NEXT_PUBLIC_API_URL="$url" NODE_OPTIONS="$node_options" \
      NEXT_PUBLIC_STATLY_ENABLE_DEV_AUTH=true STATLY_ENABLE_DEV_AUTH=true \
      nohup npm run dev:webpack </dev/null >"$log_file" 2>&1 &
    pid=$!
    set +m
    echo "$pid $port" >"$pid_file"
  }
  launch
  echo "serve-worktree: starting on $url (pid $pid); waiting up to ${timeout_seconds}s" >&2

  local deadline=$((SECONDS + timeout_seconds))
  while ((SECONDS < deadline)); do
    if ! kill -0 "$pid" 2>/dev/null; then
      # Started from an AI agent, next dev stops once to show an upgrade notice and continues when
      # the same command is retried within five minutes.
      if ((launches == 1)) && grep -q "Retry the same command" "$log_file"; then
        echo "serve-worktree: next dev stopped to show an upgrade notice; retrying once" >&2
        launch
        continue
      fi
      rm -f "$pid_file"
      [[ "$restore_generated" == true ]] && git checkout -q HEAD -- "${generated_files[@]}"
      echo "serve-worktree: the server exited; last log lines:" >&2
      tail -20 "$log_file" >&2
      exit 1
    fi
    # Any HTTP status means the server answers; the first request also compiles the home page.
    if curl -s -o /dev/null --max-time $((deadline - SECONDS + 1)) "$url/"; then
      [[ "$restore_generated" == true ]] && git checkout -q HEAD -- "${generated_files[@]}"
      print_access "ready" "$port"
      return 0
    fi
    sleep 1
  done

  [[ "$restore_generated" == true ]] && git checkout -q HEAD -- "${generated_files[@]}"
  echo "serve-worktree: no answer from $url within ${timeout_seconds}s. A cold first compile can take" >&2
  echo "  minutes on a busy machine; it is still running (log: $log_file). Raise the wait with" >&2
  echo "  SERVE_WORKTREE_TIMEOUT=<seconds>, or stop it with: npm run dev:serve -- stop" >&2
  exit 1
}

stop() {
  local server
  if ! server="$(running_server)"; then
    rm -f "$pid_file"
    echo "serve-worktree: no server started from this checkout is running"
    return 0
  fi
  local pid="${server%% *}"
  kill -TERM -- "-$pid" 2>/dev/null || true
  for _ in {1..20}; do
    kill -0 -- "-$pid" 2>/dev/null || break
    sleep 0.5
  done
  kill -KILL -- "-$pid" 2>/dev/null || true
  rm -f "$pid_file"
  echo "serve-worktree: stopped the server on port ${server#* }"
}

[[ $# -eq 1 ]] || usage
case "$1" in
  start) start ;;
  stop) stop ;;
  *) usage ;;
esac
