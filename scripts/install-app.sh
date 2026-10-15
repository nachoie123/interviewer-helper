#!/bin/bash
# npm run install-app: build "Interviewer Helper.app" and install it in /Applications.
set -e
cd "$(dirname "$0")/.."
native/live-stt/build.sh
npx electron-builder --mac --dir
APP="dist/mac-arm64/Interviewer Helper.app"
DEST="/Applications/Interviewer Helper.app"
pkill -f "^Interviewer Helper|$DEST/Contents/" 2>/dev/null || true  # main renames itself to "Interviewer Helper"
sleep 1
rm -rf "$DEST"
ditto "$APP" "$DEST"
codesign --verify --deep "$DEST" && echo "installed $DEST"
