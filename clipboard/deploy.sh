#!/usr/bin/env bash
# One-command deploy of the Shared Clipboard to Cloudflare (free tier).
#
# Needs:  CLOUDFLARE_API_TOKEN   API token (Workers Scripts:Edit, Cloudflare Pages:Edit,
#                                Account Settings:Read)
# Optional:
#         CLOUDFLARE_ACCOUNT_ID  only needed if the token can see several accounts
#         CLIPBOARD_PASSWORD     website password; set on first deploy or to change it.
#                                If unset on first deploy, a random one is generated
#                                and printed once.
#         PAGES_PROJECT          Pages project name (default: shared-clipboard)
#
# Re-running it is safe: it updates the Worker and the website in place.
set -euo pipefail

cd "$(dirname "$0")"
WRANGLER="npx -y wrangler@4.151.0"
PAGES_PROJECT="${PAGES_PROJECT:-shared-clipboard}"
WORKER_NAME="shared-clipboard"
API="https://api.cloudflare.com/client/v4"

: "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN}"
cf() { curl -fsS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/json" "$@"; }
jget() { node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const v=new Function("r","return r."+process.argv[1])(JSON.parse(s));console.log(v??"")})' "$1"; }

# --- account ---
if [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  CLOUDFLARE_ACCOUNT_ID=$(cf "$API/accounts" | jget 'result[0].id')
fi
export CLOUDFLARE_ACCOUNT_ID
echo "Account: $CLOUDFLARE_ACCOUNT_ID"

# --- workers.dev subdomain (new accounts don't have one yet) ---
WORKERS_SUB=$(cf "$API/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/subdomain" 2>/dev/null | jget 'result.subdomain' || true)
if [ -z "$WORKERS_SUB" ]; then
  WORKERS_SUB="clip-$(node -e 'console.log(require("crypto").randomBytes(4).toString("hex"))')"
  echo "Registering workers.dev subdomain: $WORKERS_SUB"
  cf -X PUT "$API/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/subdomain" -d "{\"subdomain\":\"$WORKERS_SUB\"}" >/dev/null
fi
WORKER_URL="https://$WORKER_NAME.$WORKERS_SUB.workers.dev"

# --- Pages project (created once) ---
if ! cf "$API/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$PAGES_PROJECT" >/dev/null 2>&1; then
  echo "Creating Pages project: $PAGES_PROJECT"
  $WRANGLER pages project create "$PAGES_PROJECT" --production-branch main
fi
PAGES_HOST=$(cf "$API/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/$PAGES_PROJECT" | jget 'result.subdomain')
PAGES_URL="https://$PAGES_HOST"

# --- Worker (API + Durable Object storage) ---
echo "Deploying Worker -> $WORKER_URL"
(cd worker && $WRANGLER deploy --var "ALLOWED_ORIGIN:$PAGES_URL")

# --- Password secret (only sent to Cloudflare, never written to disk or git) ---
HAS_PW=$(cd worker && $WRANGLER secret list 2>/dev/null | grep -c '"PASSWORD"' || true)
if [ -n "${CLIPBOARD_PASSWORD:-}" ]; then
  printf '%s' "$CLIPBOARD_PASSWORD" | (cd worker && $WRANGLER secret put PASSWORD)
elif [ "$HAS_PW" = "0" ]; then
  CLIPBOARD_PASSWORD=$(node -e 'console.log(require("crypto").randomBytes(15).toString("base64url"))')
  printf '%s' "$CLIPBOARD_PASSWORD" | (cd worker && $WRANGLER secret put PASSWORD)
  echo
  echo "=== Generated website password (shown once, save it): $CLIPBOARD_PASSWORD ==="
  echo
else
  echo "PASSWORD secret already set; keeping it."
fi

# --- Website: fill in the Worker URL, upload to Pages ---
BUILD=$(mktemp -d)
cp public/* "$BUILD/"
sed -i.bak "s#^const API_URL = .*#const API_URL = \"$WORKER_URL\";#" "$BUILD/script.js" && rm "$BUILD/script.js.bak"
echo "Deploying website -> $PAGES_URL"
$WRANGLER pages deploy "$BUILD" --project-name "$PAGES_PROJECT" --branch main --commit-dirty=true
rm -rf "$BUILD"

echo
echo "Website: $PAGES_URL"
echo "API:     $WORKER_URL"
