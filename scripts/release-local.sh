#!/usr/bin/env bash
# Builds and publishes the macOS release from this Mac, the way the build-macos
# and publish jobs of .github/workflows/release.yaml do, for when GitHub has no
# macOS runner ("The job was not acquired by Runner of type hosted").
#
#   scripts/release-local.sh build    builds, signs and verifies the app
#   scripts/release-local.sh publish  uploads it to the draft release and publishes it
#
# build needs a full Xcode (26 or later), the signing certificate from
# scripts/create-macos-signing-certificate.sh and the updater key. publish needs
# `gh` signed in with write access, the draft that merging the version bump
# created, and no release workflow run still queued or running.
#
#   LIBRELOG_XCODE        default /Applications/Xcode.app
#   LIBRELOG_SIGNING_DIR  default ~/.librelog-signing
#   LIBRELOG_UPDATER_KEY  default ~/.tauri/anarlog-fork-updater.key
#   LIBRELOG_BUILD_NUMBER CFBundleVersion, default the latest release run's number
set -euo pipefail

repo=Arturgrr/librelog
root="$(cd "$(dirname "$0")/.." && pwd)"
target=aarch64-apple-darwin
config="$root/apps/desktop/src-tauri/tauri.conf.stable.json"
bundle="$root/apps/desktop/src-tauri/target/$target/release/bundle"
version="$(node -p "require('$root/apps/desktop/package.json').version")"
tag="desktop_v$version"

fail() {
  echo "release-local: $*" >&2
  exit 1
}

build() {
  local xcode signing_dir updater_key xcode_version cmake_bin build_number
  xcode="${LIBRELOG_XCODE:-/Applications/Xcode.app}"
  signing_dir="${LIBRELOG_SIGNING_DIR:-$HOME/.librelog-signing}"
  updater_key="${LIBRELOG_UPDATER_KEY:-$HOME/.tauri/anarlog-fork-updater.key}"

  [[ "$(uname -sm)" == "Darwin arm64" ]] || fail "run this on an Apple silicon Mac."
  [[ -x "$xcode/Contents/Developer/usr/bin/xcodebuild" ]] ||
    fail "no Xcode at $xcode; set LIBRELOG_XCODE to one."
  [[ -f "$signing_dir/librelog-signing.p12" && -f "$signing_dir/librelog-signing.password" ]] ||
    fail "the signing certificate is missing from $signing_dir."
  [[ -f "$updater_key" ]] || fail "the updater key is missing at $updater_key."
  [[ -z "$(git -C "$root" status --porcelain -- "$config")" ]] ||
    fail "$config has local changes; commit or discard them first."

  export DEVELOPER_DIR="$xcode/Contents/Developer"
  xcode_version="$(xcodebuild -version)"
  xcode_version="${xcode_version%%$'\n'*}"
  SDKROOT="$(xcrun --sdk macosx --show-sdk-path)"
  export SDKROOT
  cmake_bin="$(ls -d "$HOME"/.local/share/mise/installs/cmake/latest/*/CMake.app/Contents/bin 2>/dev/null | head -1 || true)"
  [[ -n "$cmake_bin" ]] && export PATH="$cmake_bin:$PATH"

  export APP_VERSION="$version"
  build_number="${LIBRELOG_BUILD_NUMBER:-$(gh run list -R "$repo" --workflow release.yaml --limit 1 --json number -q '.[0].number')}"
  # The DMG script skips its Finder AppleScript styling in CI, as on GitHub.
  export CI=true

  trap 'git -C "$root" checkout -- "$config"; "$root/scripts/macos-signing-keychain.sh" cleanup || true' EXIT
  echo "== Librelog $version, build $build_number, $xcode_version"

  while IFS= read -r line; do
    export "$line"
  done < <(
    MACOS_SIGNING_CERTIFICATE="$(base64 -i "$signing_dir/librelog-signing.p12")" \
      MACOS_SIGNING_CERTIFICATE_PASSWORD="$(cat "$signing_dir/librelog-signing.password")" \
      "$root/scripts/macos-signing-keychain.sh" import
  )
  [[ -n "${APPLE_SIGNING_IDENTITY:-}" && "$APPLE_SIGNING_IDENTITY" != "-" ]] ||
    fail "the signing certificate did not import."
  TAURI_SIGNING_PRIVATE_KEY="$(cat "$updater_key")"
  export TAURI_SIGNING_PRIVATE_KEY
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""

  cd "$root"
  pnpm -F @anlg/ui build
  TAURI_ENV_TARGET_TRIPLE=$target cargo xtask prepare-binaries

  jq --arg build "$build_number" '
    .bundle.externalBin = ((.bundle.externalBin // []) + ["binaries/librelog-chrome-native-host", "binaries/check-permissions", "resources/cli/librelog-cli"] | unique)
    | .bundle.macOS.bundleVersion = $build
  ' "$config" > "$config.tmp"
  mv "$config.tmp" "$config"

  (cd apps/desktop && pnpm tauri build --target "$target" --config src-tauri/tauri.conf.stable.json)

  local app requirement leaf
  app="$bundle/macos/Librelog.app"
  codesign --verify --deep --strict --verbose=2 "$app"
  requirement="$(codesign --display --requirements - "$app" 2>&1)"
  echo "$requirement"
  leaf="$(tr '[:upper:]' '[:lower:]' <<< "$APPLE_SIGNING_IDENTITY")"
  [[ "$requirement" == *"$leaf"* ]] || fail "the app is not signed with the release certificate."

  echo "== Built and verified. Publish with: scripts/release-local.sh publish"
}

publish() {
  local commit built release_id assets
  commit="$(git -C "$root" rev-parse HEAD)"
  git -C "$root" fetch -q origin main
  git -C "$root" merge-base --is-ancestor "$commit" origin/main ||
    fail "build from a commit that is on origin/main, so the tag points at what you built."

  built="$(/usr/libexec/PlistBuddy -c "Print :CFBundleShortVersionString" "$bundle/macos/Librelog.app/Contents/Info.plist")"
  [[ "$built" == "$version" ]] || fail "the built app is $built, not $version. Run build first."
  for file in "$bundle/dmg/Librelog_${version}_aarch64.dmg" "$bundle/macos/Librelog.app.tar.gz" "$bundle/macos/Librelog.app.tar.gz.sig"; do
    [[ -f "$file" ]] || fail "$file is missing. Run build first."
  done

  [[ -z "$(gh run list -R "$repo" --workflow release.yaml --json status -q '.[] | select(.status != "completed") | .status')" ]] ||
    fail "a release workflow run is still queued or running; cancel it on GitHub first."
  release_id="$(gh api --paginate "repos/$repo/releases" --jq ".[] | select(.tag_name == \"$tag\" and .draft) | .id")"
  [[ -n "$release_id" ]] || fail "no draft release for $tag. Merging the version bump into main creates it."

  # The same names, manifest and checksums as the workflow's publish job.
  assets="$(mktemp -d)"
  # Expanded now: the EXIT trap runs after this function's locals are gone.
  trap "rm -rf \"$assets\" \"$assets.sums\"" EXIT
  cp "$bundle/dmg/Librelog_${version}_aarch64.dmg" "$assets/"
  cp "$bundle/macos/Librelog.app.tar.gz" "$assets/Librelog_${version}_aarch64.app.tar.gz"
  cp "$bundle/macos/Librelog.app.tar.gz.sig" "$assets/Librelog_${version}_aarch64.app.tar.gz.sig"
  GITHUB_REPOSITORY="$repo" node "$root/scripts/release.mjs" updater-manifest "$version" "$assets" > "$assets/latest.json"
  (cd "$assets" && shasum -a 256 -- * > "$assets.sums")
  mv "$assets.sums" "$assets/SHA256SUMS.txt"

  gh release upload "$tag" "$assets"/* -R "$repo" --clobber
  # Publishing makes latest.json reachable at releases/latest, where installed
  # apps look for updates.
  gh api -X PATCH "repos/$repo/releases/$release_id" -f tag_name="$tag" \
    -f target_commitish="$commit" -F draft=false -F prerelease=false \
    -f make_latest=true > /dev/null
  echo "== Published https://github.com/$repo/releases/tag/$tag"
}

case "${1:-}" in
  build) build ;;
  publish) publish ;;
  *)
    echo "Usage: $0 build|publish" >&2
    exit 2
    ;;
esac
