# Easy Player Mobile

This directory is reserved for the Flutter application. It consumes the Android
engine through a Kotlin plugin/service rather than accessing JNI from Dart.

Planned ownership:

- Flutter: presentation, navigation, player state UI, local database, playlists.
- Android plugin: MediaSessionService, audio focus, notification and platform channels.
- `../engine-android`: decoding, DSP and low-latency audio output.

The Flutter project is intentionally not scaffolded yet. Create it here only
after the MediaSessionService API is agreed, so the Dart UI does not couple to
unstable native engine details.
