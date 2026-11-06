#!/usr/bin/env bash
# Picks the macOS signing identity for a release build.
#
#   import   With MACOS_SIGNING_CERTIFICATE (base64 .p12) and
#            MACOS_SIGNING_CERTIFICATE_PASSWORD set, imports the certificate
#            into a temporary keychain and selects it. Otherwise selects an
#            ad-hoc signature. Writes APPLE_SIGNING_IDENTITY and
#            LIBRELOG_SIGNING_KEYCHAIN to $GITHUB_ENV, or prints them.
#   cleanup  Deletes the temporary keychain named by LIBRELOG_SIGNING_KEYCHAIN.
#
# Tauri's own APPLE_CERTIFICATE import only accepts Apple-issued certificate
# names, so self-signed certificates go through this script instead.
set -euo pipefail

emit() {
  if [[ -n "${GITHUB_ENV:-}" ]]; then
    echo "$1=$2" >> "$GITHUB_ENV"
  else
    echo "$1=$2"
  fi
}

import() {
  if [[ -z "${MACOS_SIGNING_CERTIFICATE:-}" || -z "${MACOS_SIGNING_CERTIFICATE_PASSWORD:-}" ]]; then
    echo "No signing certificate configured; using an ad-hoc signature." >&2
    emit APPLE_SIGNING_IDENTITY -
    return
  fi

  local work keychain keychain_password identity
  work="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/librelog-signing.XXXXXX")"
  keychain="$work/signing.keychain-db"
  keychain_password="$(/usr/bin/openssl rand -hex 24)"

  printf '%s' "$MACOS_SIGNING_CERTIFICATE" | base64 --decode > "$work/certificate.p12"
  security create-keychain -p "$keychain_password" "$keychain"
  security set-keychain-settings -lut 21600 "$keychain"
  security unlock-keychain -p "$keychain_password" "$keychain"
  security import "$work/certificate.p12" -k "$keychain" -f pkcs12 \
    -P "$MACOS_SIGNING_CERTIFICATE_PASSWORD" -T /usr/bin/codesign >/dev/null
  rm -f "$work/certificate.p12"
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s \
    -k "$keychain_password" "$keychain" >/dev/null

  local search_list=()
  while IFS= read -r line; do
    line="${line#"${line%%[![:space:]]*}"}"
    search_list+=("${line//\"/}")
  done < <(security list-keychains -d user)
  security list-keychains -d user -s "$keychain" "${search_list[@]}"

  # Self-signed certificates are untrusted, so list without -v.
  identity="$(security find-identity -p codesigning "$keychain" |
    awk '$1 == "1)" && $2 ~ /^[0-9A-F]{40}$/ { print $2; exit }')"
  if [[ -z "$identity" ]]; then
    echo "The certificate has no code-signing identity." >&2
    security delete-keychain "$keychain"
    exit 1
  fi

  echo "Signing with certificate $identity." >&2
  emit APPLE_SIGNING_IDENTITY "$identity"
  emit LIBRELOG_SIGNING_KEYCHAIN "$keychain"
}

cleanup() {
  if [[ -n "${LIBRELOG_SIGNING_KEYCHAIN:-}" && -e "$LIBRELOG_SIGNING_KEYCHAIN" ]]; then
    security delete-keychain "$LIBRELOG_SIGNING_KEYCHAIN"
    rm -rf "$(dirname "$LIBRELOG_SIGNING_KEYCHAIN")"
  fi
}

case "${1:-}" in
  import) import ;;
  cleanup) cleanup ;;
  *)
    echo "Usage: $0 import|cleanup" >&2
    exit 2
    ;;
esac
