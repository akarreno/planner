#!/bin/sh
# Rebuilds vendor/firebase.js from npm: only the functions listed in tools/firebase-entry.js, minified.
# Usage: tools/vendor-firebase.sh 12.19.0
set -e
VERSION=${1:?firebase version}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d)
cd "$WORK"
npm init -y >/dev/null
npm install --silent "firebase@$VERSION" esbuild@0.25
cp "$ROOT/tools/firebase-entry.js" entry.js
npx esbuild entry.js --bundle --format=esm --minify --target=es2022 --legal-comments=none \
  --banner:js="// Firebase JS SDK $VERSION (Apache-2.0), bundled from tools/firebase-entry.js" \
  --outfile="$ROOT/vendor/firebase.js"
rm -rf "$WORK"
