# Pennywise Android

WebView wrapper around the web app served by the Go backend in `../backend`.

```sh
# Build an APK that connects to production: https://wise.deeka.work
./gradlew assembleDebug
# Install directly on a connected phone or emulator:
./gradlew installDebug
# Local Go backend on the emulator host:
./gradlew installDebug -PappUrl=http://10.0.2.2:8080
# Local Vite dev server instead:
./gradlew installDebug -PappUrl=http://10.0.2.2:5173
# Physical phone over USB (10.0.2.2 only exists on the emulator):
adb reverse tcp:8080 tcp:8080
./gradlew installDebug -PappUrl=http://localhost:8080
```

Plain `http://` is allowed only in debug builds, and only for `10.0.2.2` and `localhost`
(`app/src/debug/res/xml/network_security_config.xml`). Release builds are HTTPS only.

Debug APKs are always named `pennywise-debug.apk`, generated at
`app/build/outputs/apk/debug/pennywise-debug.apk` inside `android/`.

## Release build (use this on your own phone)

Debug builds are inspectable over USB and signed with a per-machine key. Release builds
are not inspectable and use one permanent key, so updates from any machine install over
each other without logging you out.

One-time setup, outside the repo (back up the `.jks` and its password):

```sh
mkdir -p ~/keys && keytool -genkeypair -v -keystore ~/keys/pennywise-release.jks \
  -alias pennywise -keyalg RSA -keysize 4096 -validity 10000
```

Then add to `~/.gradle/gradle.properties`:

```properties
pennywiseStoreFile=/absolute/path/to/pennywise-release.jks
pennywiseStorePassword=...
pennywiseKeyAlias=pennywise
pennywiseKeyPassword=...
```

```sh
./gradlew installRelease   # → app/build/outputs/apk/release/pennywise-release.apk
```

Bump `versionCode` in `app/build.gradle.kts` for each release. Switching an installed
debug app to a release build needs one uninstall, since the signing key changes.

Open `android/` (not the repo root) in Android Studio.
