#!/bin/zsh
# Builds native/live-stt/live-stt (Info.plist embedded, so macOS can ask for Speech Recognition).
# Signed with a stable identity when there is one: an ad-hoc signature changes on every build
# and macOS would then ask for the permission again.
set -e
cd "${0:A:h}"
swiftc -O main.swift -o live-stt \
  -framework Speech -framework AVFoundation \
  -Xlinker -sectcreate -Xlinker __TEXT -Xlinker __info_plist -Xlinker Info.plist
ID=$(security find-identity -v -p codesigning 2>/dev/null | grep -E "Developer ID Application|Apple Development" | head -n 1 | awk -F '"' '{print $2}')
codesign --force --options runtime --timestamp --entitlements ../../build/entitlements.mac.plist --sign "${ID:--}" --identifier com.nachosanbenito.interviewerhelper.live-stt live-stt
echo "built $(pwd)/live-stt (signed: ${ID:-ad-hoc})"
