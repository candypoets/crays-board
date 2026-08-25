#!/usr/bin/env bash
set -euo pipefail

avd_name=${1:-google}
emulator_bin=${ANDROID_EMULATOR_BIN:-/opt/android-sdk/emulator/emulator}
log_path=${QA_EMULATOR_LOG:-/tmp/crays-board-emulator-${avd_name}.log}

if [[ ! -x "$emulator_bin" ]]; then
  echo "Android emulator not found: $emulator_bin" >&2
  exit 1
fi

mapfile -t ready_devices < <(adb devices | awk 'NR > 1 && $2 == "device" { print $1 }')
if (( ${#ready_devices[@]} > 1 )); then
  echo "More than one Android device is connected; set ANDROID_SERIAL and rerun." >&2
  printf '  %s\n' "${ready_devices[@]}" >&2
  exit 1
fi
if (( ${#ready_devices[@]} == 1 )); then
  serial=${ready_devices[0]}
  if [[ -n ${ANDROID_SERIAL:-} && $ANDROID_SERIAL != "$serial" ]]; then
    echo "Connected device $serial does not match ANDROID_SERIAL=$ANDROID_SERIAL" >&2
    exit 1
  fi
  running_avd=$(adb -s "$serial" emu avd name 2>/dev/null | head -1 | tr -d '\r')
  if [[ $running_avd == "$avd_name" ]]; then
    echo "Reusing booted Android device: $serial ($running_avd)"
    exit 0
  fi
  echo "Connected emulator $serial is AVD '${running_avd:-unknown}', not requested '$avd_name'." >&2
  echo "Stop that emulator explicitly before switching device profiles." >&2
  exit 1
fi

if ! "$emulator_bin" -list-avds | grep -Fxq "$avd_name"; then
  echo "Unknown Android AVD: $avd_name" >&2
  exit 1
fi

nohup "$emulator_bin" -avd "$avd_name" \
  -no-window \
  -no-boot-anim \
  -no-audio \
  -no-snapshot \
  -gpu swiftshader_indirect \
  >"$log_path" 2>&1 &
emulator_pid=$!
echo "Starting $avd_name (pid $emulator_pid; log $log_path)"

for _ in $(seq 1 90); do
  serial=$(adb devices | awk 'NR > 1 && $1 ~ /^emulator-/ && $2 == "device" { print $1; exit }')
  if [[ -n ${serial:-} ]]; then
    booted=$(adb -s "$serial" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')
    if [[ $booted == 1 ]]; then
      adb -s "$serial" shell input keyevent 224 >/dev/null 2>&1 || true
      echo "Android ready: $serial"
      exit 0
    fi
  fi
  if ! kill -0 "$emulator_pid" 2>/dev/null; then
    echo "Emulator exited during boot; tail of $log_path:" >&2
    tail -80 "$log_path" >&2
    exit 1
  fi
  sleep 2
done

echo "Timed out waiting for $avd_name; tail of $log_path:" >&2
tail -80 "$log_path" >&2
exit 1
