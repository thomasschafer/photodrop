#!/bin/bash
# Generate Android release keystore for signing APKs
# Run this ONCE, then add the outputs as GitHub secrets

set -e

KEYSTORE_FILE="photodrop-release.keystore"
KEY_ALIAS="photodrop"

echo "=== Generating Android Release Keystore ==="
echo ""
echo "You'll be prompted to create a password and enter some info."
echo "SAVE THE PASSWORD - you'll need it for GitHub secrets!"
echo ""

# Generate keystore
keytool -genkeypair \
  -v \
  -keystore "$KEYSTORE_FILE" \
  -alias "$KEY_ALIAS" \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000

echo ""
echo "=== Keystore Generated ==="
echo ""

# Get SHA256 fingerprint
echo "SHA256 Fingerprint (for assetlinks.json):"
keytool -list -v -keystore "$KEYSTORE_FILE" -alias "$KEY_ALIAS" | grep SHA256

echo ""
echo "=== Next Steps ==="
echo ""
echo "1. Base64 encode the keystore:"
echo "   base64 -i $KEYSTORE_FILE | pbcopy  # macOS (copies to clipboard)"
echo "   base64 -w 0 $KEYSTORE_FILE         # Linux (prints to stdout)"
echo ""
echo "2. Add these GitHub secrets (Settings → Secrets → Actions):"
echo "   ANDROID_KEYSTORE          = (the base64 output from step 1)"
echo "   ANDROID_KEYSTORE_PASSWORD = (the password you entered)"
echo "   ANDROID_KEY_ALIAS         = $KEY_ALIAS"
echo "   ANDROID_KEY_PASSWORD      = (same as keystore password, or different if you set it)"
echo ""
echo "3. Update frontend/public/.well-known/assetlinks.json with the SHA256 above"
echo ""
echo "4. Keep $KEYSTORE_FILE safe! You need it to update the app on Play Store."
echo ""
