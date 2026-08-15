# ADR-0003: Native iOS app in Swift

**Status:** Accepted — 2026-08-14

## Context

The mobile client's core requirement is privacy: speech must be transcribed **on the device**, so only text travels over the network. React Native (with modules bridging the native speech APIs, or whisper.cpp bindings) can satisfy this and would keep the repo single-language. However, the long-term vision includes deep OS integration — Siri / App Intents ("Hey Siri, ask Xavi…"), background behaviors, first-class Keychain use — where native has the clear edge.

## Decision

Build the mobile client as a **native iOS app in Swift** (`apps/ios`), using `SFSpeechRecognizer` with `requiresOnDeviceRecognition = true` for on-device transcription, developed with Xcode on macOS but versioned in this monorepo.

## Consequences

- Best possible Siri/App Intents integration path and no bridge layer to maintain.
- A second language in the repo; API contracts defined in `packages/shared` must be mirrored in Swift (kept honest by a small, stable gateway API surface).
- Android is **not** covered by this client. If Android becomes a goal, that will be a new ADR (options: Kotlin native app, or revisiting cross-platform).
- iOS builds require macOS; CI for the app is deferred to Phase 3.
