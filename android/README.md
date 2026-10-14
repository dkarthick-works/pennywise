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
```

Debug APKs are always named `pennywise-debug.apk`, generated at
`app/build/outputs/apk/debug/pennywise-debug.apk` inside `android/`.

Open `android/` (not the repo root) in Android Studio.
