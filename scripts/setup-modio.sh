#!/usr/bin/env bash
# Stores mod.io credentials in this repo's "mod.io" GitHub environment, for
# the Release workflow. Run it once, and again when the token expires.
#
#   scripts/setup-modio.sh
#
# Needs: gh (logged in as an account with admin on the repo), curl, node.
# The token is read from a hidden prompt and goes straight to GitHub; it is
# never written to disk or echoed.
#
# mod.io personal access tokens may be limited to particular resources, so
# this only uses the game and mod endpoints the upload itself needs, not /me.

set -euo pipefail

API="${MODIO_API_URL:-https://api.mod.io/v1}"
GAME_NAMEID="melvoridle"
ENV_NAME="mod.io"

repo=$(gh repo view --json nameWithOwner --jq .nameWithOwner)
echo "Repository: $repo"

# mod.io tokens are longer than the 1024 characters a terminal accepts on one
# line in its normal mode, so read with line mode (and echo) switched off.
printf "Paste your mod.io OAuth token (input hidden), then press Enter: "
saved_tty=$(stty -g)
trap 'stty "$saved_tty"' EXIT
stty -echo -icanon min 1 time 0
IFS= read -r token
stty "$saved_tty"
echo
# Drop whitespace and bracketed-paste markers some terminals wrap pastes in.
token=${token//$'\e[200~'/}
token=${token//$'\e[201~'/}
token=$(printf %s "$token" | tr -d '[:space:]')
[ -n "$token" ] || { echo "No token entered." >&2; exit 1; }
echo "Got a ${#token}-character token."

auth=(-H "Authorization: Bearer $token" -H "Accept: application/json")
modio() {
  curl -sS --max-time 30 --fail-with-body "${auth[@]}" "$API$1"
}
json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(($1)(j))})"; }

if ! game=$(modio "/games/@$GAME_NAMEID"); then
  echo "mod.io rejected the token: $game" >&2
  exit 1
fi
game_id=$(echo "$game" | json 'j=>j.id')
echo "Melvor Idle game id: $game_id"

echo
echo "Which mod should releases go to? Paste its mod.io page URL"
read -rp "(like https://mod.io/g/melvoridle/m/your-mod) or its numeric id: " which
which=$(printf %s "$which" | tr -d '[:space:]')
if [[ "$which" =~ ^[0-9]+$ ]]; then
  mod=$(modio "/games/$game_id/mods/$which")
elif [[ "$which" =~ /m/([^/?#]+) ]]; then
  found=$(modio "/games/$game_id/mods?name_id=${BASH_REMATCH[1]}")
  [ "$(echo "$found" | json 'j=>j.data.length')" = "1" ] || { echo "No Melvor Idle mod has the URL name ${BASH_REMATCH[1]}." >&2; exit 1; }
  mod=$(echo "$found" | json 'j=>JSON.stringify(j.data[0])')
else
  echo "That is neither a mod.io mod URL nor a number." >&2
  exit 1
fi
mod_id=$(echo "$mod" | json 'j=>j.id')
echo "Found: $(echo "$mod" | json 'j=>`${j.name} (id ${j.id}), by ${j.submitted_by?.username ?? "?"}, current release ${j.modfile?.version ?? "none"}`')"
read -rp "Is that the right mod? [y/N]: " ok
[[ "$ok" =~ ^[Yy] ]] || { echo "Stopped; nothing stored."; exit 1; }

# Check upload permission without uploading: a request with no file is
# rejected as invalid (422) if the token may upload, or forbidden (403) if not.
echo "Checking the token can upload to this mod (no file is sent)..."
probe=$(curl -sS --max-time 30 -w $'\n%{http_code}' "${auth[@]}" -X POST -F "version=0.0.0-permission-check" "$API/games/$game_id/mods/$mod_id/files")
code=${probe##*$'\n'}
body=${probe%$'\n'*}
case "$code" in
  422) echo "Upload permission: yes." ;;
  *)
    echo "Upload permission: no (HTTP $code): $body" >&2
    echo "Create a token that can write to this mod, then run this again. Nothing was stored." >&2
    exit 1
    ;;
esac

gh api -X PUT "repos/$repo/environments/$ENV_NAME" --silent
printf %s "$token" | gh secret set MODIO_TOKEN --env "$ENV_NAME" --repo "$repo"
gh variable set MODIO_GAME_ID --env "$ENV_NAME" --repo "$repo" --body "$game_id"
gh variable set MODIO_MOD_ID --env "$ENV_NAME" --repo "$repo" --body "$mod_id"

echo
echo "Done. The \"$ENV_NAME\" environment on $repo now has MODIO_TOKEN, MODIO_GAME_ID=$game_id, MODIO_MOD_ID=$mod_id."
