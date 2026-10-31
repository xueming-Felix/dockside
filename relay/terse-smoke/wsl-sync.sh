#!/usr/bin/env bash
# Mirror the smoke project into the WSL Linux filesystem (bun install on /mnt/c is slow).
# Layout keeps relative paths: ~/dockside-smoke/{shared,relay/dock.ts,relay/terse-smoke}
# Usage (from Windows): wsl.exe -d Ubuntu --exec bash /mnt/c/Users/lipey/Code/dockside/relay/terse-smoke/wsl-sync.sh
set -euo pipefail
B=/mnt/c/Users/lipey/Code/dockside
D="$HOME/dockside-smoke"
mkdir -p "$D/shared" "$D/relay"
rsync -a "$B/shared/" "$D/shared/"
cp "$B/relay/dock.ts" "$D/relay/dock.ts"
rsync -a --exclude node_modules --exclude generated --exclude bun.lock "$B/relay/terse-smoke/" "$D/relay/terse-smoke/"
printf 'export PATH=$HOME/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin\n' > "$D/env.sh"
cd "$D"
find . -path ./relay/terse-smoke/node_modules -prune -o -path ./relay/generated -prune -o -type f -print | sort
echo "--- dock.ts version:"
grep -n "fn.length\|DOCK_ACTOR_ID ??" relay/dock.ts || true
sha1sum relay/dock.ts
