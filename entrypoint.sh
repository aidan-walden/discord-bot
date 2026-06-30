#!/bin/sh
set -e

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

if [ "$(id -g bun)" != "$PGID" ]; then
	groupmod -o -g "$PGID" bun
fi

if [ "$(id -u bun)" != "$PUID" ]; then
	usermod -o -u "$PUID" bun
fi

if [ -e config.yml ]; then
	chown bun:bun config.yml
fi

exec setpriv --reuid="$PUID" --regid="$PGID" --init-groups "$@"
