#!/usr/bin/env bash
set -e

cleanup() {
  podman-compose -f compose.test.yml down -v
}
trap cleanup EXIT

podman-compose -f compose.test.yml up -d

echo "Waiting for postgres..."
podman-compose -f compose.test.yml exec postgres \
  sh -c 'until pg_isready -U postgres -d test; do sleep 1; done'

DATABASE_URL_TESTING="${DATABASE_URL_TESTING:-postgresql://postgres:postgres@localhost:5432/test}" bun test
