#!/usr/bin/env bash
# Build a Release .app for the iOS Simulator with embedded JS.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

mkdir -p artifacts
DERIVED="$ROOT/artifacts/ios-derived"

xcodebuild \
  -workspace ios/JCodeMobile.xcworkspace \
  -scheme JCodeMobile \
  -configuration Release \
  -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' \
  -derivedDataPath "$DERIVED" \
  CODE_SIGNING_ALLOWED=NO \
  build

APP="$DERIVED/Build/Products/Release-iphonesimulator/JCodeMobile.app"
if [ ! -d "$APP" ]; then
  echo "Release .app not found at $APP" >&2
  exit 1
fi
VERSION="$(bun -p "require('./package.json').version")"
rm -f "artifacts/jcode-mobile-$VERSION-ios-simulator.app.zip"
ditto -c -k --norsrc --keepParent "$APP" "artifacts/jcode-mobile-$VERSION-ios-simulator.app.zip"
shasum -a 256 "artifacts/jcode-mobile-$VERSION-ios-simulator.app.zip" | tee "artifacts/jcode-mobile-$VERSION-ios-simulator.app.zip.sha256"
ls -lh "artifacts/jcode-mobile-$VERSION-ios-simulator.app.zip"
