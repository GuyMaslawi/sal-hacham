#!/usr/bin/env bash
# Builds the file to upload to Google Play, signed with your upload key:
#
#   ./build-release.sh        → android/app/build/outputs/bundle/release/app-release.aab
#
# Before each new upload, raise versionCode in app/build.gradle by one.
set -euo pipefail
cd "$(dirname "$0")"

export JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export SAL_UPLOAD_KEYSTORE="${SAL_UPLOAD_KEYSTORE:-$HOME/sal-hacham-keys/upload.jks}"

if [ ! -f "$SAL_UPLOAD_KEYSTORE" ]; then
  echo "No upload key at $SAL_UPLOAD_KEYSTORE. Create one first: ./make-upload-key.sh"
  exit 1
fi

read -r -s -p "Upload key password: " SAL_UPLOAD_PASSWORD
echo
export SAL_UPLOAD_PASSWORD

./gradlew --console=plain --quiet clean bundleRelease

AAB="app/build/outputs/bundle/release/app-release.aab"
"$JAVA_HOME/bin/jarsigner" -verify "$AAB" >/dev/null
echo
echo "Ready to upload: $(pwd)/$AAB"
grep -E "versionCode|versionName" app/build.gradle | sed 's/^ */  /'
