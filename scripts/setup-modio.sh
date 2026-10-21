#!/usr/bin/env bash
# Stores mod.io credentials in this repo's "mod.io" GitHub environment, for
# the Release workflow. Run it once, and again when the token expires (yearly).
#
#   scripts/setup-modio.sh
#
# Needs: gh (logged in as an account with admin on the repo), curl, node.
# The token is read from a hidden prompt and goes straight to GitHub; it is
# never written to disk or echoed.

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

modio() {
  curl -sS --fail-with-body -H "Authorization: Bearer $token" -H "Accept: application/json" "$API$1"
}
json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(($1)(j))})"; }

if ! me=$(modio /me); then
  echo "mod.io rejected the token: $me" >&2
  exit 1
fi
echo "Token belongs to mod.io user: $(echo "$me" | json 'j=>j.username')"

game_id=$(modio "/games/@$GAME_NAMEID" | json 'j=>j.id')
echo "Melvor Idle game id: $game_id"

mods=$(modio "/me/mods?game_id=$game_id")
count=$(echo "$mods" | json 'j=>j.data.length')
if [ "$count" = "0" ]; then
  echo "This mod.io account has no Melvor Idle mods. Create the mod on mod.io first (upload 0.2.3 by hand), then re-run." >&2
  exit 1
fi
echo "Your Melvor Idle mods:"
echo "$mods" | json 'j=>j.data.map((m,i)=>`  ${i+1}) ${m.name}  (id ${m.id}, current ${m.modfile?.version ?? "none"})`).join("\n")'
if [ "$count" = "1" ]; then
  pick=1
else
  read -rp "Which one is Task Keeper? [1-$count]: " pick
fi
mod_id=$(echo "$mods" | json "j=>j.data[$((pick - 1))].id")
mod_name=$(echo "$mods" | json "j=>j.data[$((pick - 1))].name")
echo "Using: $mod_name (id $mod_id)"

gh api -X PUT "repos/$repo/environments/$ENV_NAME" --silent
printf %s "$token" | gh secret set MODIO_TOKEN --env "$ENV_NAME" --repo "$repo"
gh variable set MODIO_GAME_ID --env "$ENV_NAME" --repo "$repo" --body "$game_id"
gh variable set MODIO_MOD_ID --env "$ENV_NAME" --repo "$repo" --body "$mod_id"

echo
echo "Done. The \"$ENV_NAME\" environment on $repo now has MODIO_TOKEN, MODIO_GAME_ID=$game_id, MODIO_MOD_ID=$mod_id."
