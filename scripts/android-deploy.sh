#!/usr/bin/env bash
# Build the Android app and install it on a connected device or emulator,
# replacing whatever's currently installed.
#
# Usage: bash scripts/android-deploy.sh [options]
#
# Options:
#   --release        Build a signed release APK instead of the debug build.
#                     Requires crates/librarium-tauri/gen/android/keystore.properties
#                     to exist (see AGENTS.md's "Android release signing").
#   --no-launch       Install but don't launch the app afterward.
#   -t, --target ARCH  Rust/NDK target arch to build for (default: aarch64,
#                      the real-device ABI; use x86_64 for an Intel/AMD
#                      emulator image).
#   -s, --serial ID    adb device/emulator serial to install on (as shown by
#                      `adb devices`). Required if more than one is attached.
#
# Prerequisites: same Android build environment cargo tauri android build
# already needs (see AGENTS.md's "Android build" section) — JDK, Android
# SDK/NDK, cargo-ndk, tauri-cli, the Rust Android targets — plus `adb` on
# PATH and a device with USB debugging enabled and authorized.
#
# Examples:
#   bash scripts/android-deploy.sh                    # debug build -> connected device
#   bash scripts/android-deploy.sh -s R58N...          # pick a device explicitly
#   bash scripts/android-deploy.sh --release           # signed release build
#   bash scripts/android-deploy.sh -t x86_64 --no-launch

set -euo pipefail

TARGET="aarch64"
BUILD_FLAGS=(--apk --debug)
LAUNCH=1
SERIAL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --release)
      BUILD_FLAGS=(--apk)
      shift
      ;;
    --no-launch)
      LAUNCH=0
      shift
      ;;
    -t|--target)
      TARGET="${2:?--target needs an argument (e.g. aarch64, x86_64)}"
      shift 2
      ;;
    -s|--serial)
      SERIAL="${2:?--serial needs a device ID (see \`adb devices\`)}"
      shift 2
      ;;
    -h|--help)
      sed -n '2,27p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

command -v adb >/dev/null 2>&1 || {
  echo "error: adb not found on PATH — install Android SDK platform-tools." >&2
  exit 1
}

ADB=(adb)
if [[ -n "$SERIAL" ]]; then
  ADB=(adb -s "$SERIAL")
fi

# Fail early and clearly on "no device" / "more than one device" rather than
# letting `adb install` guess (or fail with a less helpful message) later.
DEVICE_COUNT="$("${ADB[@]}" devices | tail -n +2 | grep -c device$ || true)"
if [[ "$DEVICE_COUNT" -eq 0 ]]; then
  echo "error: no adb device/emulator attached. Plug in your device, enable" >&2
  echo "       USB debugging, and authorize this computer, or start an emulator." >&2
  exit 1
elif [[ "$DEVICE_COUNT" -gt 1 && -z "$SERIAL" ]]; then
  echo "error: more than one device attached — pass -s <serial>:" >&2
  "${ADB[@]}" devices
  exit 1
fi

if [[ "${BUILD_FLAGS[0]}" == "--apk" && "${#BUILD_FLAGS[@]}" -eq 1 ]]; then
  KEYSTORE_PROPS="$REPO_ROOT/crates/librarium-tauri/gen/android/keystore.properties"
  if [[ ! -f "$KEYSTORE_PROPS" ]]; then
    echo "error: --release requires $KEYSTORE_PROPS to exist." >&2
    echo "       See AGENTS.md's \"Android release signing\" section." >&2
    exit 1
  fi
fi

echo "==> Building (target: $TARGET, flags: ${BUILD_FLAGS[*]})"
(cd "$REPO_ROOT/crates/librarium-tauri" && cargo tauri android build "${BUILD_FLAGS[@]}" -t "$TARGET")

BUILD_TYPE="debug"
[[ "${BUILD_FLAGS[0]}" == "--apk" && "${#BUILD_FLAGS[@]}" -eq 1 ]] && BUILD_TYPE="release"
APK="$REPO_ROOT/crates/librarium-tauri/gen/android/app/build/outputs/apk/universal/$BUILD_TYPE/app-universal-$BUILD_TYPE.apk"

if [[ ! -f "$APK" ]]; then
  echo "error: expected APK not found at $APK" >&2
  exit 1
fi

echo "==> Installing $(du -h "$APK" | cut -f1) APK on $("${ADB[@]}" devices | tail -n +2 | head -1 | cut -f1)"
"${ADB[@]}" install -r "$APK"

if [[ "$LAUNCH" -eq 1 ]]; then
  echo "==> Launching"
  "${ADB[@]}" shell am start -n com.librarium.app/.MainActivity >/dev/null
fi

echo "==> Done"
