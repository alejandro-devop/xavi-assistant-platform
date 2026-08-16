# Roadmap

Each phase produces something usable on its own. A phase is done when every checkbox is checked and the "Definition of done" holds. Once the repo is on GitHub, each phase becomes a Milestone and each checkbox an Issue.

Phases 1–3 are executed by the agent chains, not by hand: each has a detailed spec in [specs/](specs/) ending with a ready-to-paste kickoff prompt. See [DEVELOPMENT-WORKFLOW.md](DEVELOPMENT-WORKFLOW.md#running-a-phase).

## Phase 0 — Foundation

Goal: a healthy, publishable monorepo and the core infrastructure running on the host.

- [x] Git repository and planning docs (this document, architecture, ADRs)
- [x] pnpm workspaces + Turborepo scaffolding (`apps/`, `packages/`)
- [x] Root tooling: TypeScript config, ESLint + Prettier, `.editorconfig`
- [x] Security hygiene: strict `.gitignore`, `.env.example`, gitleaks (pre-commit + CI)
- [x] CI: GitHub Actions running lint, typecheck, secret scan
- [x] `infra/docker-compose.yml` with n8n (persistent volume, localhost-only, n8n's built-in auth)
- [x] Ollama installed on the host with an instruct model pulled (`qwen2.5:7b`, native)
- [x] Cloudflare Tunnel serving n8n editor behind Cloudflare Access (locally-managed tunnel `xavi-assistant`; unauthenticated requests are redirected to the Access login)
- [x] `infra/README.md`: how to bring everything up from scratch
- [x] Agent toolkit wired in: `/cazabugs-init` run against the real environment (see [DEVELOPMENT-WORKFLOW.md](DEVELOPMENT-WORKFLOW.md))

**Definition of done:** a fresh clone + documented steps brings up n8n and Ollama; the n8n editor is reachable only through Cloudflare Access; CI is green; gitleaks finds nothing.

## Phase 1 — Minimal brain

Goal: send a text command with curl, get an intelligent response back.

Spec: [specs/phase-1-minimal-brain.md](specs/phase-1-minimal-brain.md) — built through the `forja` feature chain.

- [x] `packages/shared`: command/response types and the skill contract
- [x] `apps/gateway`: Fastify service with bearer-token auth
- [x] Intent detection via Ollama (small instruct model, structured output)
- [x] Skill registry: typed mapping of intents → n8n webhooks
- [x] First end-to-end skill: a trivial n8n workflow (e.g. "ping" / echo) triggered through the gateway
- [x] Cloudflare Tunnel hostname for the gateway API (`api.<domain>`, no Access in front — the bearer token is its door)
- [x] Gateway tests (intent routing, auth) in CI

**Definition of done:** `curl -H "Authorization: Bearer …" api.<domain> -d '{"text": "…"}'` classifies the intent and round-trips through n8n from outside the network.

## Phase 2 — First real skills

Goal: Xavi does two genuinely useful things every day.

Spec: [specs/phase-2-real-skills.md](specs/phase-2-real-skills.md) — two features, run one at a time.

- [ ] Skill: **Today's agenda** — n8n workflow reading the calendar, returns a natural-language summary
- [ ] Skill: **Email review** — n8n workflow reading the inbox, returns a prioritized summary
- [x] Summarization prompts refined for Ollama (concise, spoken-friendly output)
- [x] Sanitized workflow exports committed to `infra/n8n/workflows/`
- [x] Fallback behavior: unknown intent → helpful response listing what Xavi can do

**Definition of done:** "what's on my plate today?" and "check my email" both work end-to-end via curl.

Both workflows are built, reviewed and imported, but stay unchecked until they answer with real data. Three things they still wait on, none of them code: the host's Ollama listens on `127.0.0.1` only, so the containers cannot summarize (`OLLAMA_HOST`); the Google Calendar and Gmail credentials must be created and attached in the n8n editor; and the workflows are imported deactivated. See the closing notes in [FEAT-002](features/FEAT-002-todays-agenda-skill.md) and [FEAT-003](features/FEAT-003-email-review-skill.md).

## Phase 3 — iOS app

Goal: talk to Xavi from the phone; audio never leaves the device.

Spec: [specs/phase-3-ios-app.md](specs/phase-3-ios-app.md). **Hard precondition: the Cloudflare Tunnel is live and `https://api.<domain>/healthz` answers from outside the network** — the tunnel-to-gateway wiring (Phase 1's last item) must be done before this phase starts. Runs on the Mac with Xcode.

- [ ] `apps/ios`: Swift app scaffold (Xcode project in the monorepo)
- [ ] On-device speech-to-text (`SFSpeechRecognizer`, `requiresOnDeviceRecognition = true`)
- [ ] Send transcribed text to the gateway; render the response
- [ ] Token storage in the iOS Keychain
- [ ] Basic conversation UI (request/response history)

**Definition of done:** speaking to the app triggers a skill and shows the answer, with the phone on cellular (i.e., through the tunnel).

## Phase 4 — Evolution

Direction, not commitments. Groomed when Phase 3 ships — see [specs/phase-4-evolution.md](specs/phase-4-evolution.md) for the grooming rule.

- Voice replies (TTS — on-device iOS voices first)
- Siri / App Intents integration ("Hey Siri, ask Xavi…")
- Conversation memory / context across commands
- Proactive notifications (n8n schedules → push)
- More skills (home automation, reminders, notes…)
- Android app (decision deferred — see ADR-0003)
