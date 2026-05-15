#!/bin/sh
set -eu

export PGDATA="${PGDATA:-/var/lib/postgresql/data}"
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-change-me}"
export DATABASE_URL="${DATABASE_URL:-postgres://review_assistant:${POSTGRES_PASSWORD}@127.0.0.1:5432/review_assistant}"

mkdir -p "$PGDATA"
mkdir -p /run/postgresql
chown -R postgres:postgres "$PGDATA"
chown -R postgres:postgres /run/postgresql

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  su-exec postgres initdb -D "$PGDATA"
fi

su-exec postgres pg_ctl -D "$PGDATA" -o "-c listen_addresses=127.0.0.1" -w start

if ! psql --username postgres --dbname postgres --tuples-only --no-align -c "select 1 from pg_roles where rolname = 'review_assistant'" | grep -q 1; then
  createuser --username postgres review_assistant
fi

escaped_password="$(printf "%s" "$POSTGRES_PASSWORD" | sed "s/'/''/g")"
psql --username postgres --dbname postgres \
  -c "alter role review_assistant with login password '${escaped_password}'"

if ! psql --username postgres --dbname postgres --tuples-only --no-align -c "select 1 from pg_database where datname = 'review_assistant'" | grep -q 1; then
  createdb --username postgres --owner review_assistant review_assistant
fi

npm run db:migrate
npm run worker &
worker_pid="$!"

shutdown() {
  kill "$worker_pid" 2>/dev/null || true
  su-exec postgres pg_ctl -D "$PGDATA" -m fast -w stop
}

trap shutdown INT TERM

npm run start &
web_pid="$!"
wait "$web_pid"
