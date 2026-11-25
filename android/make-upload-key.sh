#!/usr/bin/env bash
# Creates the upload key that Google Play uses to recognise uploads as yours. Run it once:
#
#   ./make-upload-key.sh
#
# You choose the password; it is asked for here, never shown and never stored. Keep the key file and the
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

# The password is read here, hidden, and handed to keytool through the environment, so it never
# shows on screen. (keytool's own prompt for -list echoed it in Terminal.)
read -r -s -p "Choose a password (at least 6 characters; nothing shows as you type): " SAL_KEY_PW
echo
read -r -s -p "Type it again: " SAL_KEY_PW_AGAIN
echo
if [ "$SAL_KEY_PW" != "$SAL_KEY_PW_AGAIN" ]; then
  echo "The two passwords are different. Nothing was created; run the script again."
  exit 1
fi
if [ "${#SAL_KEY_PW}" -lt 6 ]; then
  echo "The password needs at least 6 characters. Nothing was created; run the script again."
  exit 1
fi
unset SAL_KEY_PW_AGAIN
export SAL_KEY_PW

"$KEYTOOL" -genkeypair -keystore "$KEYSTORE" -alias upload -keyalg RSA -keysize 2048 -validity 10000 \
  -dname "CN=Sal Hacham, C=IL" -storepass:env SAL_KEY_PW -keypass:env SAL_KEY_PW
chmod 600 "$KEYSTORE"

echo
echo "Created $KEYSTORE"
echo "Its SHA-256 fingerprint (needed for the site's assetlinks.json):"
"$KEYTOOL" -list -v -keystore "$KEYSTORE" -alias upload -storepass:env SAL_KEY_PW | grep -E "SHA256:"
unset SAL_KEY_PW
