#!/bin/sh
# Runs as wrangler's [build] command (see wrangler.toml). Only acts during a
# production deploy on Cloudflare Workers Builds; does nothing locally, in
# preview builds, or when the PASSWORD build secret is not set.
set -eu

[ "${WORKERS_CI:-}" = "1" ] && [ "${WRANGLER_COMMAND:-}" = "deploy" ] && [ -n "${PASSWORD:-}" ] || exit 0

# 1. Copy the build-time PASSWORD into hello-world's runtime secret
#    (value piped via stdin, never printed).
printf "%s" "$PASSWORD" | npx wrangler secret put PASSWORD

# 2. Deploy the "clipboard" Worker (same site, bound to hello-world's storage)
#    with the same PASSWORD supplied as JSON on stdin.
#    The CI name variables are removed for this one command: Workers Builds sets
#    them for hello-world, and WRANGLER_CI_OVERRIDE_NAME would otherwise make
#    wrangler deploy this config onto hello-world instead of "clipboard".
node -e 'process.stdout.write(JSON.stringify({ PASSWORD: process.env.PASSWORD }))' |
  env -u WRANGLER_CI_OVERRIDE_NAME -u WRANGLER_CI_MATCH_TAG -u WRANGLER_CI_GENERATE_PREVIEW_ALIAS \
    npx wrangler deploy -c wrangler.clipboard.toml --secrets-file /dev/stdin
