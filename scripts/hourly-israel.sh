#!/bin/bash
# The hourly job on Guy's Mac. It fetches the chains that refuse GitHub's servers and uploads
# them for the site's own hourly rebuild (minute 17), so this runs a few minutes before it.
#
# Installed as ~/Library/LaunchAgents/io.github.guymaslawi.salhacham.israel.plist, running from a
# separate copy of this repository in ~/Library/Application Support/SalHachamSync/repo: macOS
# does not let background jobs read ~/Documents.
#
#   Stop it:    launchctl bootout gui/$(id -u)/io.github.guymaslawi.salhacham.israel
#   Run it now: launchctl kickstart gui/$(id -u)/io.github.guymaslawi.salhacham.israel
#   Logs:       ~/Library/Logs/SalHacham/ (history.log, one line a run; last-run.log in full)

set -u
export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOGS="$HOME/Library/Logs/SalHacham"
LOCK="$DIR/.local-data/hourly.lock"
mkdir -p "$LOGS" "$DIR/.local-data"

stamp() { date '+%Y-%m-%d %H:%M'; }

# One run at a time; a lock older than two hours belongs to a run that died.
if ! mkdir "$LOCK" 2>/dev/null; then
  if [ -n "$(find "$LOCK" -maxdepth 0 -mmin +120 2>/dev/null)" ]; then
    rm -rf "$LOCK" && mkdir "$LOCK"
  else
    echo "$(stamp) skipped: the previous run is still going" >> "$LOGS/history.log"
    exit 0
  fi
fi
trap 'rm -rf "$LOCK"' EXIT

cd "$DIR" || exit 1
git pull --ff-only -q >/dev/null 2>&1 || true

started=$(date +%s)
node scripts/sync/israel-only.ts --hourly > "$LOGS/last-run.log" 2>&1
status=$?
took=$(( $(date +%s) - started ))
result=$(grep -E 'nothing to send|Uploaded' "$LOGS/last-run.log" | tail -1)
echo "$(stamp) exit $status after ${took}s: ${result:-see last-run.log}" >> "$LOGS/history.log"
# Keep the history short.
tail -n 1000 "$LOGS/history.log" > "$LOGS/history.tmp" && mv "$LOGS/history.tmp" "$LOGS/history.log"
exit $status
