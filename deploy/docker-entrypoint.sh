#!/bin/sh
set -eu
umask 077
for directory in /data "$HOME" "$CODEX_HOME" /data/.deps /data/.runtime /data/.profile /data/.logs /data/.uploads /data/.downloads; do
    if ! mkdir -p "$directory" || [ ! -w "$directory" ]; then
        printf 'Cannot write %s. Set volume ownership to container UID/GID %s:%s.\n' "$directory" "$(id -u)" "$(id -g)" >&2
        exit 1
    fi
done
exec /app/scripts/start --yes "$@"
