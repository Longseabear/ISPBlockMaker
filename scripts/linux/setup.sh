#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
command -v node >/dev/null 2>&1 || { echo 'Install Node.js 24+ and npm first.' >&2; exit 1; }
node -e 'if(process.platform!=="linux"||Number(process.versions.node.split(".")[0])<24){console.error("Linux with Node.js 24+ is required");process.exit(1)}'
command -v npm >/dev/null 2>&1 || { echo 'npm is required.' >&2; exit 1; }
command -v git >/dev/null 2>&1 || { echo 'Git is required.' >&2; exit 1; }
for tool in python3 make g++; do
 command -v "$tool" >/dev/null 2>&1 || { echo "Missing $tool. Ubuntu/Debian: sudo apt-get install git python3 build-essential" >&2; exit 1; }
done
npm ci --omit=dev --no-audit --no-fund
chmod +x ./isp-block-maker
echo 'Ready. Run: ./isp-block-maker /absolute/path/to/workspace'
