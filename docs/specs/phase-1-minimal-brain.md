# Phase 1 spec — Minimal brain

> Feed this document to the `feature-analyst` to start the phase. It is a
> spec, not a dossier: the analyst still writes the dossier, cuts the final
> slices and surfaces decisions — but every decision already taken here is
> settled and must not be re-asked.

## Goal

Send a text command with `curl` from outside the network, get an intelligent
response back: the gateway authenticates the request, detects the intent with
the local LLM, triggers the matching n8n workflow and returns its answer.

**Definition of done (from the roadmap):**
`curl -H "Authorization: Bearer …" https://api.<domain>/command -d '{"text": "…"}'`
classifies the intent and round-trips through n8n from outside the network.
(The public-hostname part is gated on the tunnel token — see "User-gated
steps"; everything else must work on `localhost:8787` first.)

## Context — what already exists

Read `docs/bugs/ENVIRONMENT.md` first (and run `./infra/probe.sh`). Short
version: xavi's n8n answers on `localhost:5679` with a working `ping` webhook
(`POST /webhook/ping` → `{"ok":true,"reply":"pong",...}`), host-native Ollama
answers on `localhost:11434` with `qwen2.5:7b`, and `packages/shared` is an
empty typed stub waiting for the real contracts.

## Decisions already taken (do not re-ask)

| Decision         | Value                                                                                                                                                  | Why                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Framework        | Fastify on Node 22, TypeScript strict ESM                                                                                                              | planned in ARCHITECTURE.md                                        |
| Package          | `apps/gateway`, name `@xavi/gateway`                                                                                                                   | repo layout                                                       |
| Port             | `8787`, bound to `127.0.0.1`                                                                                                                           | reserved in ENVIRONMENT.md; tunnel is the only public entrance    |
| Auth             | static bearer token from `GATEWAY_BEARER_TOKEN` env var; every route except `/healthz` requires it                                                     | single-client personal assistant; revisit when more clients exist |
| Intent detection | Ollama `/api/chat` with `format: "json"`, model from `OLLAMA_MODEL` env (default `qwen2.5:7b`), server `OLLAMA_URL` (default `http://localhost:11434`) | local-first (ADR-0004)                                            |
| Skill dispatch   | typed registry mapping intent → n8n webhook path, webhook base from `N8N_WEBHOOK_BASE` (default `http://localhost:5679/webhook`)                       | keeps gateway a thin router                                       |
| Shared contracts | request/response + skill types live in `packages/shared`, gateway imports them                                                                         | contracts change atomically (ADR-0001/0002)                       |
| Tests            | Vitest, colocated `*.test.ts`, runnable via `pnpm test` (turbo)                                                                                        | one dev dep, TS-native                                            |
| Config           | `.env` at `apps/gateway/.env` (gitignored), documented in `apps/gateway/.env.example`                                                                  | same hygiene as infra                                             |

## Behavior required

- `GET /healthz` → `200 {"status":"ok"}`, no auth.
- `POST /command` with `{"text": string}`:
  - Missing/wrong bearer token → `401`, no information leaked.
  - Empty or non-string `text` → `400` with a short error.
  - Otherwise: intent detection → skill dispatch → `200` with a response
    shaped by the shared types, at minimum
    `{ok, intent, reply, skillResult?}`.
- Intents in this phase: `ping` (routes to the existing n8n `ping` webhook)
  and `unknown` (no skill matched → polite reply listing what Xavi can do,
  without calling n8n).
- Intent detection prompt: instruct the model to answer ONLY JSON
  `{"intent": "<one of the registry>", "params": {}}`; unknown/ambiguous text
  maps to `unknown`. Model output that fails to parse also maps to `unknown`
  (log it, don't 500).
- n8n webhook failures (down, non-2xx, timeout ≤ 5s) → `502` with
  `{ok: false, intent, error: "skill_unavailable"}` — never a hang, never an
  unhandled crash.
- The user may write in Spanish or English; `reply` mirrors the user's
  language when it comes from the LLM (the `ping` skill's reply may stay
  literal).

## Out of scope for this phase

Real skills (email, calendar — Phase 2), streaming responses, conversation
memory, rate limiting beyond what Cloudflare gives, TLS (the tunnel provides
it), multi-user auth, iOS anything.

## Suggested slices (analyst owns the final cut)

1. Gateway skeleton: `/healthz` + authenticated `/command` echoing back —
   deployable, testable, no LLM yet.
2. Intent detection via Ollama with the `unknown` fallback.
3. Skill registry + `ping` round trip through n8n (uses the existing
   workflow; `infra/n8n/workflows/ping.json` is the reference).
4. Tunnel exposure of `api.<domain>` (**user-gated**, see below) + docs.

## User-gated steps

- **Cloudflare Tunnel**: needs the user's domain and `TUNNEL_TOKEN` in
  `infra/.env`, plus the dashboard hostname `api.<domain>` →
  `http://localhost:8787` (`cloudflared` runs with `network_mode: host`
  because the gateway binds `127.0.0.1` and the docker bridge cannot reach
  it — verified 2026-08-16). Agents write config/docs but the user
  brings the tunnel up. This is also the **hard precondition for Phase 3** —
  the iOS app only talks to the gateway through this hostname.
- Generating the real `GATEWAY_BEARER_TOKEN` value (agents document
  `openssl rand -hex 32`, user runs it into the `.env`).

## Constraints

- Minimal dependencies: fastify (+ its type provider if needed) and vitest.
  Anything more needs a written reason in the dossier.
- Follow the chain protocol (`docs/features/PROTOCOL.md`): builder never
  commits, reviewer verifies against the analyst's literal criteria.
- Never write a secret into a tracked file; CI runs gitleaks.
- Lint/typecheck/format must stay green (`pnpm lint && pnpm typecheck && pnpm format`).

## Kickoff prompt

```
Start Phase 1 of this project. Read docs/specs/phase-1-minimal-brain.md,
docs/DEVELOPMENT-WORKFLOW.md and docs/bugs/ENVIRONMENT.md, then run
./infra/probe.sh to see what's up. Pass the spec to the feature-analyst
subagent as the feature request (include today's date in its prompt). Stop
after the dossier is written and show me the decisions it left for me, if
any. Then, on my go: feature-architect if the dossier says yes, then
feature-builder → feature-reviewer one slice at a time, pausing between
links to report. Nobody commits — I do. Treat spec decisions marked
"already taken" as settled.
```
