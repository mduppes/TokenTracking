#!/bin/sh
# Creates a self-signed code-signing certificate ("TokenTracking Local Signing") in your login keychain,
# so every build of the menu bar app keeps the same identity. Without it, each build gets a throwaway
# ad-hoc signature and macOS forgets per-app settings like "Allow in the Menu Bar".
# The certificate is only trusted on this Mac, for code signing. Remove it any time in Keychain Access.
set -eu
NAME="TokenTracking Local Signing"
if security find-identity -v -p codesigning | grep -q "$NAME"; then echo "\"$NAME\" already exists."; exit 0; fi
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/cert.cnf" <<CNF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $NAME
[ext]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
CNF
openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -keyout "$TMP/key.pem" -out "$TMP/cert.pem" -config "$TMP/cert.cnf" 2>/dev/null
PASS="$(openssl rand -hex 16)" # only protects the temporary .p12 file
# macOS's importer needs the legacy PKCS#12 encryption (OpenSSL 3 defaults to AES); LibreSSL has no -legacy flag.
openssl pkcs12 -export -legacy -inkey "$TMP/key.pem" -in "$TMP/cert.pem" -name "$NAME" -out "$TMP/id.p12" -passout "pass:$PASS" 2>/dev/null \
  || openssl pkcs12 -export -inkey "$TMP/key.pem" -in "$TMP/cert.pem" -name "$NAME" -out "$TMP/id.p12" -passout "pass:$PASS"
security import "$TMP/id.p12" -k "$HOME/Library/Keychains/login.keychain-db" -P "$PASS" -T /usr/bin/codesign >/dev/null
echo "Trusting the certificate for code signing (macOS will ask for your password)…"
security add-trusted-cert -r trustRoot -p codeSign -k "$HOME/Library/Keychains/login.keychain-db" "$TMP/cert.pem"
security find-identity -v -p codesigning | grep "$NAME" && echo "Done. Rebuild with: npm run build:menubar"
