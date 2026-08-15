# Roadmap

Each phase produces something usable on its own. A phase is done when every checkbox is checked and the "Definition of done" holds. Once the repo is on GitHub, each phase becomes a Milestone and each checkbox an Issue.

## Phase 0 — Foundation

Goal: a healthy, publishable monorepo and the core infrastructure running on the host.

- [x] Git repository and planning docs (this document, architecture, ADRs)
- [x] pnpm workspaces + Turborepo scaffolding (`apps/`, `packages/`)
- [x] Root tooling: TypeScript config, ESLint + Prettier, `.editorconfig`
- [x] Security hygiene: strict `.gitignore`, `.env.example`, gitleaks (pre-commit + CI)
- [x] CI: GitHub Actions running lint, typecheck, secret scan
- [x] `infra/docker-compose.yml` with n8n (persistent volume, localhost-only, n8n's built-in auth)
- [x] Ollama installed on the host with an instruct model pulled (`qwen2.5:7b`, native)
- [ ] Cloudflare Tunnel serving n8n editor behind Cloudflare Access (needs the domain + tunnel token in `infra/.env`)
- [x] `infra/README.md`: how to bring everything up from scratch
- [ ] Agent toolkit wired in: `/cazabugs-init` run against the real environment (see [DEVELOPMENT-WORKFLOW.md](DEVELOPMENT-WORKFLOW.md); waiting on the toolkit's English rewrite to merge)

**Definition of done:** a fresh clone + documented steps brings up n8n and Ollama; the n8n editor is reachable only through Cloudflare Access; CI is green; gitleaks finds nothing.

## Phase 1 — Minimal brain

Goal: send a text command with curl, get an intelligent response back.

Built through the `forja` feature chain (run `/forja-init` first — it reuses the cazabugs `ENTORNO.md`).

- [ ] `packages/shared`: command/response types and the skill contract
- [ ] `apps/gateway`: Fastify service with bearer-token auth
- [ ] Intent detection via Ollama (small instruct model, structured output)
- [ ] Skill registry: typed mapping of intents → n8n webhooks
- [ ] First end-to-end skill: a trivial n8n workflow (e.g. "ping" / echo) triggered through the gateway
- [ ] Cloudflare Tunnel hostname for the gateway API
- [ ] Gateway tests (intent routing, auth) in CI

**Definition of done:** `curl -H "Authorization: Bearer …" api.<domain> -d '{"text": "…"}'` classifies the intent and round-trips through n8n from outside the network.

## Phase 2 — First real skills

Goal: Xavi does two genuinely useful things every day.

- [ ] Skill: **Today's agenda** — n8n workflow reading the calendar, returns a natural-language summary
- [ ] Skill: **Email review** — n8n workflow reading the inbox, returns a prioritized summary
- [ ] Summarization prompts refined for Ollama (concise, spoken-friendly output)
- [ ] Sanitized workflow exports committed to `infra/n8n/workflows/`
- [ ] Fallback behavior: unknown intent → helpful response listing what Xavi can do

**Definition of done:** "what's on my plate today?" and "check my email" both work end-to-end via curl.

## Phase 3 — iOS app

Goal: talk to Xavi from the phone; audio never leaves the device.

- [ ] `apps/ios`: Swift app scaffold (Xcode project in the monorepo)
- [ ] On-device speech-to-text (`SFSpeechRecognizer`, `requiresOnDeviceRecognition = true`)
- [ ] Send transcribed text to the gateway; render the response
- [ ] Token storage in the iOS Keychain
- [ ] Basic conversation UI (request/response history)

**Definition of done:** speaking to the app triggers a skill and shows the answer, with the phone on cellular (i.e., through the tunnel).

## Phase 4 — Evolution

Direction, not commitments. Groomed when Phase 3 ships.

- Voice replies (TTS — on-device iOS voices first)
- Siri / App Intents integration ("Hey Siri, ask Xavi…")
- Conversation memory / context across commands
- Proactive notifications (n8n schedules → push)
- More skills (home automation, reminders, notes…)
- Android app (decision deferred — see ADR-0003)
