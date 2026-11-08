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

## SMS import preview (manual delivery only)

Backend migration `0016_sms_ingestion` and the web Settings device-token controls are required.
Maintainers must populate the global sender list; it starts empty. See
[`../docs/research/android-sms-ingestion-implementation.md`](../docs/research/android-sms-ingestion-implementation.md)
for the configuration SQL and API contracts.

1. Create a token in web Settings → Android SMS import.
2. Tap the native **Android SMS settings** button above the WebView, paste the token and connect.
3. Read the disclosure, enable SMS import, grant `READ_SMS`, then tap **Scan now**.

The first scan starts at today's beginning; re-enablement starts at the time of re-enabling.
Each scan catches up at most one day, with overlap. Matching messages are queued in private
Room/SQLite, uploaded with fingerprint deduplication, and processed when the operator enables
`SMS_AI_ENABLED=true` on the backend. Complete messages with explicit dates can become
review drafts; incomplete messages are rejected. See the
[Phase 4 processing contract](../docs/research/android-sms-phase4.md).
Review, edit, approve or ignore drafts in **SMS Drafts** under the app's Tools menu.
Only approval creates a ledger Transaction; see [Phase 5](../docs/research/android-sms-phase5.md).
**Daily scheduling and foreground scanning are not enabled.**
The native token is independent of browser login: disable native import or revoke the token when
switching accounts/ownership. Ordinary browser logout does not revoke device credentials.

`READ_SMS` is hard-restricted; runtime consent alone may not suffice. Verify the real installer
and phone even if emulator tests pass. Native SMS settings block screenshots; all Android app
backups/device transfer are excluded to keep queued SMS and token preferences off backups.
Raw payload retention is seven days (local expiration is checked on scan; backend hourly).

Checks:

```sh
./gradlew testDebugUnitTest assembleDebug
# Requires a running emulator or attached device:
./gradlew connectedDebugAndroidTest
```
