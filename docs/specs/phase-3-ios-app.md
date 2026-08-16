# Phase 3 spec — iOS app

> Feed this to the `feature-analyst` when the precondition below holds.

## Hard precondition — do not start without it

**The Cloudflare Tunnel must be live and serving the gateway**:
`https://api.<domain>/healthz` answers from outside the local network (e.g.
a phone on cellular). The app has no business existing before its server is
reachable. If this isn't true yet, stop and tell the user what's missing
(tunnel token in `infra/.env`, dashboard hostname `api.<domain>` →
`http://localhost:8787` — see `infra/README.md`).

**Where this phase runs:** the app is built with Xcode on the user's Mac —
the repo is cloned there and the chain runs in a Claude Code session on that
machine. The Linux host only matters as the server side.

## Goal

Talk to Xavi from the phone. Audio never leaves the device: speech is
transcribed on-device and only text travels, over the tunnel, to the gateway.

**Definition of done (from the roadmap):** speaking to the app triggers a
skill and shows the answer, with the phone on cellular.

## Decisions already taken (do not re-ask)

| Decision       | Value                                                                                                                                                             | Why                                                   |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Stack          | Native Swift + SwiftUI, Xcode project at `apps/ios` inside this monorepo                                                                                          | ADR-0003                                              |
| Speech-to-text | `SFSpeechRecognizer` with `requiresOnDeviceRecognition = true`; if the device/locale can't do on-device, DON'T fall back to server recognition — show why instead | privacy is the point (ADR-0003/0004)                  |
| Locales        | Spanish first (`es`), English second — user speaks Spanish                                                                                                        | user preference                                       |
| Token storage  | iOS Keychain (`kSecClassGenericPassword`); settings screen pastes token + base URL once                                                                           | never in UserDefaults, never hardcoded                |
| Networking     | `URLSession` straight to `https://api.<domain>` with the bearer header; no third-party HTTP libs                                                                  | minimal deps                                          |
| Contracts      | mirror `packages/shared` request/response types as Swift `Codable` structs, kept small; a comment links them to the TS source                                     | ADR-0003 consequence                                  |
| Min iOS        | 17                                                                                                                                                                | modern SwiftUI, on-device recognition is mature there |

## Behavior required

- Main screen: push-to-talk button (hold or tap-toggle), live transcription
  shown while speaking, then the exchange (you said / Xavi replied) appended
  to a conversation history (in-memory + lightweight persistence is enough).
- Send flow: transcribed text → `POST /command` → render `reply`. Show
  intent tag subtly (debug-friendly, showcase-friendly).
- States that must exist: mic/speech permission not granted (explain and
  link to Settings), offline/tunnel unreachable (say so, keep the text so
  the user can retry), gateway `401` (token screen), slow response
  (progress state, 15s timeout).
- Text input fallback (type instead of speak) — costs little, makes the app
  usable in quiet places and testable in the simulator.

## Out of scope

Siri/App Intents ("Hey Siri, ask Xavi") — Phase 4. Voice replies (TTS) —
Phase 4. Android. Push notifications. Account systems. App Store anything.

## User-gated steps

- Apple Developer signing (personal team is fine for a personal device).
- Running on the physical iPhone and confirming the cellular round trip —
  agents can verify simulator + localhost, the reviewer must leave the
  cellular check written as a manual test for the user.

## Constraints

- The chain protocol applies; the builder works in the Xcode project but
  never commits.
- Keep the project generatable/buildable from a fresh clone (document any
  Xcode setup in `apps/ios/README.md`).
- No analytics, no third-party SDKs.

## Kickoff prompt

```
Start Phase 3 of this project (run this on the Mac with Xcode). First
verify the hard precondition in docs/specs/phase-3-ios-app.md — if
https://api.<domain>/healthz doesn't answer from outside the network,
stop and tell me what's missing. Otherwise read the spec,
docs/DEVELOPMENT-WORKFLOW.md and docs/bugs/ENVIRONMENT.md, and pass the
spec to the feature-analyst as the feature request with today's date.
Stop after the dossier to show me pending decisions; then architect if
the dossier says yes, then builder → reviewer slice by slice with pauses
between links. Nobody commits — I do.
```
