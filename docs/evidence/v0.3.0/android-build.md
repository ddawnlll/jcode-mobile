# Android release build (2026-11-11)

Host: Debian GNU/Linux 13, x86_64 VPS.

## Toolchain detection

```text
java -version
openjdk version "21.0.13" 2026-10-20
OpenJDK Runtime Environment (build 21.0.13+9-1-deb13u2-Debian)
OpenJDK 64-Bit Server VM (build 21.0.13+9-1-deb13u2-Debian, mixed mode, sharing)

cd android && ./gradlew --version
Gradle 9.4.1
Launcher JVM:  21.0.13 (Debian 21.0.13+9-1-deb13u2-Debian)
Daemon JVM:    /usr/lib/jvm/java-21-openjdk-amd64

SDK:           /home/quant/android-sdk
platforms:     android-36, android-37.0
build-tools:   36.0.0, 37.0.0
NDK:           27.1.12297006
CMake:         3.30.5
```

The release script auto-detected JDK 21 at
`/usr/lib/jvm/java-21-openjdk-amd64` and the SDK at
`/home/quant/android-sdk`.

## Build

```sh
cd /home/quant/jcode-mobile
bash scripts/build-android-release.sh
```

The first cold build compiled native modules for `arm64-v8a` and
`armeabi-v7a` and completed in 37m 6s. A JDK 21 rebuild reused the compiled
native outputs, recompiled the app under JDK 21, and completed in 13m 22s
(894 tasks: 68 executed, 826 up-to-date).

Result:

```text
BUILD SUCCESSFUL in 13m 22s
artifacts/jcode-mobile-0.2.2-android-release.apk
8c9c4801e42c8b4f60fc90602e19397b41e520e2ae49c1e776a523a9f63da087
65,802,162 bytes (63 MiB)
```

## Artifact verification

```text
apksigner verify --verbose --print-certs
Verifies
Verified using v2 scheme (APK Signature Scheme v2): true
V2 Signer certificate DN: CN=Android Debug, OU=Android, O=Unknown, ...
V2 Signer certificate SHA-256: fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c

aapt2 dump badging
package: name='com.jcodemobile.app' versionCode='4' versionName='0.2.2'
compileSdkVersion='37'
minSdkVersion:'24'
targetSdkVersion:'36'
application-label:'JCode Mobile'

zipalign -c -v 4
Verification successful

unzip -l
classes.dex
lib/arm64-v8a/libreactnative.so
lib/armeabi-v7a/libreactnative.so
assets/index.android.bundle
```

## Boundaries

- This is the existing Expo/React Native JCode Mobile 0.2.2 client, not the
  Stillness 12 Tauri app. Stillness has no Android shell in this repository.
- The APK is debug-signed for sideloading, not Play Store signed.
- No emulator or physical device was attached on this host, so install,
  launch, and runtime flows are `NOT_RUN` for this build.
