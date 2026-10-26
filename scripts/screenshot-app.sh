#!/bin/bash
# Capture a Minerva window to a PNG, for VISUAL VERIFICATION. DOM/rect checks
# ignore clipping and have passed a viewer the user saw empty — every UI check
# must end with LOOKING at a screenshot.
#
# Dispatches by platform:
#   - macOS / anything else: CDP (scripts/screenshot-cdp.mjs). Needs the app
#     started with `npm run dev -- -- --remote-debugging-port=9222`.
#   - Linux + Hyprland (hyprctl and grim installed, window found): native window
#     capture, as before. Set MINERVA_SCREENSHOT=cdp to force the CDP path.
#
# Usage: scripts/screenshot-app.sh [out.png] [title-pattern]
#   pattern: the main window by default; on the CDP path it is a regex over the
#   page title or url (e.g. "didactic" for the detached didactic window).
set -euo pipefail

OUT="${1:-/tmp/minerva-$(date +%H%M%S).png}"
TITLE_PATTERN="${2:-}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

use_hyprland() {
  [[ ${MINERVA_SCREENSHOT:-} != cdp ]] &&
    [[ $(uname -s) == Linux ]] &&
    command -v hyprctl >/dev/null && command -v grim >/dev/null && command -v jq >/dev/null &&
    [[ -n ${HYPRLAND_INSTANCE_SIGNATURE:-} ]]
}

if use_hyprland; then
  GEO=$(hyprctl clients -j | jq -r --arg t "${TITLE_PATTERN:-Minerva}" \
    '.[] | select(.class == "proj-minerva" and (.title | test($t))) | "\(.at[0]),\(.at[1]) \(.size[0])x\(.size[1])"' | head -1)
  if [[ -n $GEO ]]; then
    grim -g "$GEO" "$OUT"
    echo "$OUT"
    exit 0
  fi
  echo "No Hyprland window matched; falling back to CDP." >&2
fi

exec node "$HERE/screenshot-cdp.mjs" "$OUT" ${TITLE_PATTERN:+"$TITLE_PATTERN"}
