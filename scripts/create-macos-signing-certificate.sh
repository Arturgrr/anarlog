#!/usr/bin/env bash
# Creates the self-signed code-signing certificate that release builds use
# until Librelog has an Apple Developer ID.
#
# A stable certificate gives every build the same designated requirement, so
# macOS keeps Microphone, Screen & System Audio Recording, and Accessibility
# grants across updates. Gatekeeper still treats the app as unnotarized.
#
# Usage: scripts/create-macos-signing-certificate.sh [output-directory]
# The directory receives the .p12 bundle and its password, readable only by you.
# Back it up: a new certificate makes testers grant permissions once more.
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Run this on a Mac." >&2
  exit 1
fi

out_dir="${1:-$HOME/.librelog-signing}"
common_name="${LIBRELOG_SIGNING_NAME:-Librelog Self-Signed Code Signing}"
p12="$out_dir/librelog-signing.p12"
password_file="$out_dir/librelog-signing.password"

if [[ -e "$p12" ]]; then
  echo "$p12 already exists. Move it away first if you really want a new certificate." >&2
  exit 1
fi

umask 077
mkdir -p "$out_dir"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

cat > "$work/openssl.cnf" <<EOF
[req]
distinguished_name = dn
prompt = no
x509_extensions = codesign
[dn]
CN = $common_name
[codesign]
basicConstraints = critical, CA:false
keyUsage = critical, digitalSignature
extendedKeyUsage = critical, codeSigning
subjectKeyIdentifier = hash
EOF

# The system LibreSSL writes PKCS#12 files that `security import` accepts on
# every supported macOS; OpenSSL 3 defaults need extra legacy flags.
openssl=/usr/bin/openssl

"$openssl" req -new -x509 -newkey rsa:3072 -nodes -sha256 -days 3650 \
  -config "$work/openssl.cnf" \
  -keyout "$work/key.pem" -out "$work/certificate.pem" 2>/dev/null
"$openssl" rand -base64 32 | tr -d '\n' > "$password_file"
"$openssl" pkcs12 -export \
  -inkey "$work/key.pem" -in "$work/certificate.pem" -name "$common_name" \
  -passout "file:$password_file" -out "$p12"

fingerprint="$("$openssl" x509 -in "$work/certificate.pem" -noout -fingerprint -sha1 | cut -d= -f2 | tr -d :)"

cat <<EOF
Created $p12
Certificate: $common_name
SHA-1: $fingerprint (builds will require this certificate)

Store it as repository secrets without printing it:

  base64 -i "$p12" | gh secret set MACOS_SIGNING_CERTIFICATE -R Arturgrr/librelog
  gh secret set MACOS_SIGNING_CERTIFICATE_PASSWORD -R Arturgrr/librelog < "$password_file"

Keep $out_dir backed up and private.
EOF
