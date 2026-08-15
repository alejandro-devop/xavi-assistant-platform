# Phase 4 spec — Evolution (directional)

Phase 4 is direction, not commitment: it gets groomed into real specs when
Phase 3 is delivered. Do NOT feed this file to the analyst as-is — when the
time comes, each bullet that survives becomes its own spec (or goes straight
to the analyst if it hangs off something existing by then).

Candidate features, in rough order of value:

1. **Voice replies (TTS)** — on-device iOS voices (`AVSpeechSynthesizer`)
   reading Xavi's reply; the ≤120-word summary constraint from Phase 2
   exists for this.
2. **Siri / App Intents** — "Hey Siri, ask Xavi…" without opening the app;
   the reason the app is native (ADR-0003).
3. **Conversation memory** — follow-ups like "and tomorrow?" resolving
   against the previous command; probably gateway-side with a short
   rolling context, still local.
4. **Proactive notifications** — n8n schedules (morning agenda push,
   important-email alert) reaching the phone; transport TBD (APNs needs
   infra thought — that's a real spec's job).
5. **More skills** — reminders, notes, home automation; each one is a small
   Phase-2-shaped feature (n8n workflow + registry entry).
6. **Android** — would be a NEW ADR superseding ADR-0003's scope, not a
   silent addition.

Grooming rule: when Phase 3 ships, pick the top one or two, write them as
specs following the Phase 1/2/3 format (goal, context, decisions taken,
behavior, out of scope, user-gated steps, kickoff prompt), and only then
release the analyst.
