# Android release build - JCode Mobile 0.3.0

Host: Debian GNU/Linux 13, x86_64 VPS.

This is the **Stillness 12 Tauri 2 client** (`apps/stillness`), not the older
Expo 0.2.2 app. The APK package is `dev.jcode.stillness`, versionName `0.3.0`,
versionCode `3000`.

## Toolchain detection

```text
java -version
openjdk version "21.0.13" 2026-10-20
OpenJDK Runtime Environment (build 21.0.13+9-1-deb13u2-Debian)
OpenJDK 64-Bit Server VM (build 21.0.13+9-1-deb13u2-Debian, mixed mode, sharing)

Gradle 9.6.1
Launcher JVM:  21.0.13
Daemon JVM:    /usr/lib/jvm/java-21-openjdk-amd64

SDK:           /home/quant/android-sdk
platforms:     android-36, android-37.0
build-tools:   36.0.0, 37.0.0
NDK:           27.1.12297006
CMake:         3.30.5
Rust targets:  aarch64-linux-android, armv7-linux-androideabi,
               x86_64-linux-android, i686-linux-android
```

`scripts/build-android-release.sh` now builds the v0.3.0 Stillness client and
`scripts/build-expo-android-release.sh` retains the old 0.2.2 Expo build.

## Build

```sh
cd /home/quant/jcode-mobile
bash scripts/build-android-release.sh
```

The script detects JDK 21 and the SDK, installs missing Rust Android targets,
builds the frontend, runs `tauri android build --apk --target aarch64 armv7`,
zipaligns, signs the APK, and verifies it. Observed run: 4m 31s with the native
crate cache warm.

Result:

```text
artifacts/jcode-mobile-0.3.0-android-release.apk
11,020,965 bytes
4a79ba0aeaf026949ecbdb57591fc7e18dd87fb47d10c67ff49bf03be63060d2
```

## Artifact verification

```text
apksigner verify --verbose
Verifies
Verified using v2 scheme (APK Signature Scheme v2): true
Verified using v3 scheme (APK Signature Scheme v3): true
Signer: CN=Android Debug, OU=Android, O=Unknown, ...
Certificate SHA-256: fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c

aapt2 dump badging
package: name='dev.jcode.stillness' versionCode='3000' versionName='0.3.0'
compileSdkVersion='37'
minSdkVersion:'24'
targetSdkVersion:'37'
application-label:'JCode Mobile'

zipalign -c -v 4
Verification successful

unzip -l
lib/arm64-v8a/libstillness_lib.so
lib/armeabi-v7a/libstillness_lib.so
assets/tauri.conf.json
```

The APK is debug-signed for sideloading, matching the earlier 0.2.2 release
policy. A Play Store/release keystore was not provided.

## Runtime evidence

A disposable Pixel API 36 `default;x86_64` emulator ran under KVM. A debug
x86_64 build of the same source was installed because the release APK contains
only the two ARM ABIs.

1. `adb install` succeeded and `dev.jcode.stillness/.MainActivity` became the
   top resumed activity.
2. The Stillness 12 welcome screen rendered at 1080x2400
   (`android-stillness-welcome.png`).
3. A real staging adapter (`0.3.0`, harness connected) was started on
   `127.0.0.1:7646`; the emulator used `adb reverse tcp:7646 tcp:7646`.
4. Entering the one-time code on the phone produced `DEVICE TOKEN ACCEPTED`,
   the adapter logged `device connected device=dev_2c1ecc13...`, and the
   adapter database recorded a device named `JCode Mobile`
   (`android-stillness-pairing.png`).
5. The app was force-stopped and relaunched. It restored the token from the
   Android Keystore-backed store and opened `Your work.` with `Harness online`
   (`android-stillness-relaunch.png`).

The Android credential path uses the `android-keyring` crate: an Android
Keystore key encrypts the credential stored in SharedPreferences. The desktop
build keeps the Linux Secret Service implementation.

## Boundaries

- Runtime evidence is from an emulator, not a physical phone.
- The release APK is ARM-only and debug-signed.
- The Tauri-generated Android project is committed under
  `apps/stillness/src-tauri/gen/android`; build outputs, generated Wry Kotlin,
  jniLibs, and copied config remain ignored.
- The older Expo 0.2.2 APK is still at
  `artifacts/jcode-mobile-0.2.2-android-release.apk` for historical comparison
  and is not the 0.3.0 release.
