#!/usr/bin/env bash
# Creates the upload key that Google Play uses to recognise uploads as yours. Run it once:
#
#   ./make-upload-key.sh
#
# You choose the password; it is asked for here and never stored. Keep the key file and the
# password somewhere safe (a password manager holds both well). If they are ever lost, Google can
# reset the upload key, because Google keeps the real signing key itself (Play App Signing).
set -euo pipefail

KEY_DIR="${SAL_KEY_DIR:-$HOME/sal-hacham-keys}"
KEYSTORE="$KEY_DIR/upload.jks"
KEYTOOL="/Applications/Android Studio.app/Contents/jbr/Contents/Home/bin/keytool"

if [ -f "$KEYSTORE" ]; then
  echo "There is already an upload key at $KEYSTORE; not replacing it."
  exit 1
fi
mkdir -p "$KEY_DIR"
chmod 700 "$KEY_DIR"

echo "Choose a password of at least 6 characters. You will type it twice; nothing shows as you type."
"$KEYTOOL" -genkeypair -keystore "$KEYSTORE" -alias upload -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "CN=Sal Hacham, C=IL"
chmod 600 "$KEYSTORE"

echo
echo "Created $KEYSTORE"
echo "Its SHA-256 fingerprint (needed for the site's assetlinks.json; type the password once more):"
"$KEYTOOL" -list -v -keystore "$KEYSTORE" -alias upload | grep -E "SHA256:"
