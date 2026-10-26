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

# Melvor Idle's mod.io game id. mod.io only accepts writes on the game's own
# API host (g-<id>.modapi.io); the old api.mod.io host is deprecated.
GAME_ID=2869
API="${MODIO_API_URL:-https://g-$GAME_ID.modapi.io/v1}"
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

if ! game=$(modio "/games/$GAME_ID"); then
  echo "mod.io rejected the token: $game" >&2
  exit 1
fi
game_id=$GAME_ID
echo "Game: $(echo "$game" | json 'j=>j.name') (id $game_id)"

echo
echo "Which mod should releases go to? Paste its mod.io page URL"
read -rp "(like https://mod.io/g/melvoridle/m/your-mod) or its numeric id: " which
which=$(printf %s "$which" | tr -d '[:space:]')

# The token owner's own Melvor Idle mods, hidden and not-yet-live ones
# included, which the public listing leaves out. If mod.io refuses (tokens
# limited to particular resources may not read /me), says why on stderr and
# prints nothing.
my_mods() {
  local reply code
  reply=$(curl -sS --max-time 30 -w $'\n%{http_code}' "${auth[@]}" "$API/me/mods?game_id=$game_id$1") || return 0
  code=${reply##*$'\n'}
  if [ "$code" = "200" ]; then
    printf %s "${reply%$'\n'*}"
  else
    echo "(mod.io wouldn't list your own mods: HTTP $code $(printf %s "${reply%$'\n'*}" | head -c 300))" >&2
  fi
}
# How many mods a listing holds; 0 for an empty or unreadable reply.
count() { printf %s "$1" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let n=0;try{n=(JSON.parse(s).data||[]).length}catch(e){}console.log(n)})'; }

if [[ "$which" =~ ^[0-9]+$ ]]; then
  if ! mod=$(modio "/games/$game_id/mods/$which"); then
    echo "mod.io has no Melvor Idle mod $which that this token can see: $mod" >&2
    exit 1
  fi
elif [[ "$which" =~ /m/([^/?#]+) ]]; then
  name_id=${BASH_REMATCH[1]}
  found=$(modio "/games/$game_id/mods?name_id=$name_id")
  # Hidden mods aren't in the public listing; look in the owner's own mods.
  [ "$(count "$found")" = "1" ] || found=$(my_mods "&name_id=$name_id")
  if [ "$(count "$found")" != "1" ]; then
    echo "Couldn't find a Melvor Idle mod with the URL name \"$name_id\"." >&2
    mine=$(my_mods "")
    if [ "$(count "$mine")" -gt 0 ]; then
      echo "Your Melvor Idle mods (id, name, URL name):" >&2
      printf %s "$mine" | json 'j=>j.data.map(m=>`  ${m.id}  ${m.name}  (${m.name_id})`).join("\n")' >&2
      echo "Run this again and enter the id." >&2
    else
      echo "mod.io didn't list any Melvor Idle mods for this token. If the mod is hidden, either:" >&2
      echo "  - run this again with its numeric id instead of the URL, or" >&2
      echo "  - make a token at https://mod.io/me/access that isn't limited to particular resources, or" >&2
      echo "  - make the mod public for a moment, run this, and hide it again." >&2
    fi
    exit 1
  fi
  mod=$(printf %s "$found" | json 'j=>JSON.stringify(j.data[0])')
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
  403)
    echo "Upload permission: no (HTTP 403): $body" >&2
    echo "Create a token that can write to this mod, then run this again. Nothing was stored." >&2
    exit 1
    ;;
  *)
    echo "Could not check upload permission (HTTP $code): $body" >&2
    echo "Nothing was stored." >&2
    exit 1
    ;;
esac

gh api -X PUT "repos/$repo/environments/$ENV_NAME" --silent
printf %s "$token" | gh secret set MODIO_TOKEN --env "$ENV_NAME" --repo "$repo"
gh variable set MODIO_GAME_ID --env "$ENV_NAME" --repo "$repo" --body "$game_id"
gh variable set MODIO_MOD_ID --env "$ENV_NAME" --repo "$repo" --body "$mod_id"

echo
echo "Done. The \"$ENV_NAME\" environment on $repo now has MODIO_TOKEN, MODIO_GAME_ID=$game_id, MODIO_MOD_ID=$mod_id."
