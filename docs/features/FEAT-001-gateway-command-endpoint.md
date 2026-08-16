---
id: FEAT-001
title: Send a text command and get back an intent-routed answer (gateway "brain")
status: delivered
architect: yes # new app, new package contracts, no existing gateway/service pattern in the repo — see reason below
area: gateway
requested: 2026-08-15
updated: 2026-08-15
---

# FEAT-001 — Send a text command and get back an intent-routed answer

## 1. The request — feature-analyst

**Summary for whoever's next:** Build the Fastify gateway (`apps/gateway`)
that authenticates a bearer-token request, classifies its intent with the
local Ollama model, dispatches to the matching n8n webhook (or an `unknown`
fallback) and returns a structured JSON reply. First slice: an authenticated
`/healthz` + `/command` skeleton that echoes back, deployable and testable
with no LLM involved yet.

**What problem it solves:** Xavi (the assistant) needs a single entry point
that turns a plain-text command sent from outside the home network into a
dispatched action, without the caller knowing which skill/workflow handles
it. This is the "minimal brain" — Phase 1 of the roadmap — the precondition
for both the iOS app (Phase 3) and every future skill (Phase 2+).

**Who it's for:** The project owner (Alejandro), initially via `curl`; later
the iOS app, through the same endpoint.

**User's words:** This feature comes from a written spec, not a live
conversation, so there's no separate paraphrase to preserve. The spec's own
framing of the goal (`docs/specs/phase-1-minimal-brain.md`, "Goal" section)
is the closest thing to the requester's words and is quoted verbatim:

> "Send a text command with `curl` from outside the network, get an
> intelligent response back: the gateway authenticates the request, detects
> the intent with the local LLM, triggers the matching n8n workflow and
> returns its answer."
>
> Definition of done: `curl -H "Authorization: Bearer …" https://api.<domain>/command -d '{"text": "…"}'`
> classifies the intent and round-trips through n8n from outside the
> network. (Public-hostname part is gated on the tunnel token — see
> "User-gated steps" below; everything else must work on `localhost:8787`
> first.)

**Decisions already taken (settled by the spec — do not re-ask):**

| Decision         | Value                                                                                                                                                  | Why                                                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Framework        | Fastify on Node 22, TypeScript strict ESM                                                                                                              | planned in ARCHITECTURE.md                                        |
| Package          | `apps/gateway`, name `@xavi/gateway`                                                                                                                   | repo layout                                                       |
| Port             | `8787`, bound to `127.0.0.1`                                                                                                                           | reserved in ENVIRONMENT.md; tunnel is the only public entrance    |
| Auth             | static bearer token from `GATEWAY_BEARER_TOKEN` env var; every route except `/healthz` requires it                                                     | single-client personal assistant; revisit when more clients exist |
| Intent detection | Ollama `/api/chat` with `format: "json"`, model from `OLLAMA_MODEL` env (default `qwen2.5:7b`), server `OLLAMA_URL` (default `http://localhost:11434`) | local-first (ADR-0004)                                            |
| Skill dispatch   | typed registry mapping intent → n8n webhook path, webhook base from `N8N_WEBHOOK_BASE` (default `http://localhost:5679/webhook`)                       | keeps gateway a thin router                                       |
| Shared contracts | request/response + skill types live in `packages/shared` (currently an empty typed stub, `packages/shared/src/index.ts`), gateway imports them         | contracts change atomically (ADR-0001/0002)                       |
| Tests            | Vitest, colocated `*.test.ts`, runnable via `pnpm test` (turbo)                                                                                        | one dev dep, TS-native                                            |
| Config           | `.env` at `apps/gateway/.env` (gitignored), documented in `apps/gateway/.env.example`                                                                  | same hygiene as infra                                             |

**Constraints (also settled, from the spec):**

- Minimal dependencies: `fastify` (+ type provider if needed) and `vitest`.
  Anything more needs a written reason from whoever adds it.
- Builder never commits; reviewer verifies against the criteria below,
  literally.
- Never write a secret into a tracked file (CI runs gitleaks).
- `pnpm lint && pnpm typecheck && pnpm format` must stay green.

**Out of scope:**

- Real skills beyond `ping` (email, calendar — Phase 2).
- Streaming responses.
- Conversation memory / multi-turn context.
- Rate limiting beyond what Cloudflare provides.
- TLS (the tunnel terminates it).
- Multi-user auth (single static bearer token only).
- Anything iOS (Phase 3).
- Actually bringing the Cloudflare Tunnel up, or generating the real
  `GATEWAY_BEARER_TOKEN` secret value — both are user-gated (see below);
  agents write the config/docs, not the secrets.

**Acceptance criteria:**

- [ ] `GET /healthz` → `200 {"status":"ok"}`, no auth required.
- [ ] `POST /command` with a missing or wrong `Authorization: Bearer …`
      header → `401`, with a body that leaks no internal information (no
      stack trace, no hint about the correct token).
- [ ] `POST /command` with a correct token but missing/empty/non-string
      `text` → `400` with a short error message.
- [ ] `POST /command` with a correct token and valid `text` → `200` with a
      body shaped at minimum `{ok, intent, reply, skillResult?}`, typed from
      `packages/shared`.
- [ ] Text that the model classifies as `ping` → gateway calls the existing
      n8n `POST /webhook/ping` and folds its response into `skillResult`.
- [ ] Text that doesn't match any registered intent, or whose model output
      fails to parse as the expected JSON shape, → `intent: "unknown"`,
      `200`, a reply that lists what Xavi can currently do, and **no** call
      to n8n. A parse failure is logged, never a `500`.
- [ ] If the n8n `ping` webhook is down, returns non-2xx, or doesn't answer
      within 5s → `502` with `{ok: false, intent, error: "skill_unavailable"}`.
      No hang, no unhandled crash regardless of which of the three causes it.
- [ ] A command written in Spanish and one written in English both work; the
      `reply` field mirrors the input language when it comes from the LLM
      (the `ping` skill's own reply may stay literal — it's not
      LLM-generated).
- [ ] `pnpm lint && pnpm typecheck && pnpm format` pass with the new code in
      place.
- [ ] `pnpm test` runs the new Vitest suite for `apps/gateway` and it's
      green.
- [ ] No secret value (bearer token, tunnel token) appears in any tracked
      file; `.env` stays gitignored and `.env.example` documents the shape
      with placeholder values only.

**Slices:** (vertical, each usable/testable on its own — matches the spec's
suggestion, which the analyst confirms as the right cut)

| #   | What it does                                                                                                                                                                                                                           | State   |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| 1   | Gateway skeleton: `/healthz` (no auth) + authenticated `/command` that echoes `text` back. No LLM, no n8n yet.                                                                                                                         | pending |
| 2   | Intent detection wired in: `/command` calls Ollama, parses `{"intent","params"}`, falls back to `unknown` on any parse/format failure — but no skill dispatch yet, so a matched intent still doesn't reach n8n.                        | pending |
| 3   | Skill registry + `ping` round trip: a detected `ping` intent calls the real n8n `ping` webhook, folds its reply into `skillResult`, and handles the down/non-2xx/timeout cases with `502`.                                             | pending |
| 4   | Tunnel exposure: `infra/.env` shape, Cloudflare dashboard hostname docs (`api.<domain>` → `host.docker.internal:8787`), `.env.example` for the gateway. Config/docs only — the user brings the tunnel up and drops in the real tokens. | pending |

Four slices, which sits at the healthy edge the protocol names (3-4); each is
independently testable against `localhost:8787` except the very last leg of
slice 4 (the public hostname), which needs the user's tunnel token to
verify end-to-end — that gap is explicit in the slice's own description, not
hidden.

**Architect? yes** because this introduces a new concept, not an extension of
one that exists: `apps/gateway` doesn't exist yet (`apps/` currently holds
only a `.gitkeep`), there is no other Fastify service in the repo to imitate,
and `packages/shared` is presently an empty stub
(`packages/shared/src/index.ts`) with no request/response/skill types to
extend — the architect needs to design that shape, the folder layout inside
`apps/gateway`, and where the Ollama client / skill registry / n8n dispatcher
each live before the builder starts. Confirmed empty via direct read, not
assumed.

**Decisions that aren't mine:** none outstanding. Every decision the spec
left open is already resolved in the "Decisions already taken" table above.
The two remaining user-only actions are **not** decisions between options —
the spec already settled how they're handled — they're actions only the user
can execute, and neither blocks slices 1-3:

- **Cloudflare Tunnel** (domain + `TUNNEL_TOKEN` in `infra/.env`, dashboard
  hostname `api.<domain>` → `http://host.docker.internal:8787`): resolved —
  agents write config/docs, the user brings the tunnel up. This is also the
  hard precondition for Phase 3 (iOS talks to the gateway only through this
  hostname). Only slice 4's public-hostname verification depends on it;
  slices 1-3 are fully verifiable against `localhost:8787`.
- **`GATEWAY_BEARER_TOKEN` real value**: resolved — agents document
  `openssl rand -hex 32` in `.env.example`'s comments, the user runs it into
  the gitignored `.env`. For building/testing slices 1-3, the builder may
  generate its own throwaway local value in the gitignored `apps/gateway/.env`
  (never in a tracked file) — that's implementation detail, not a decision
  requiring the user's input.

## 2. The plan — feature-architect

**Summary for the builder:** There is no Fastify service to imitate — you are
writing the repo's first one, and it becomes the reference (`ENVIRONMENT.md`
"Live patterns" already says so). Imitate `packages/shared` for how a
workspace package plugs into pnpm/turbo/root tooling, and treat
`infra/n8n/workflows/ping.json` + the verified curl in `docs/bugs/ENVIRONMENT.md`
as the webhook contract. Do NOT touch `turbo.json`, `pnpm-workspace.yaml`,
`.gitignore`, `eslint.config.mjs`, CI, or `infra/.env.example` — they all
already accommodate the gateway as-is.

**What already exists:** (each confirmed by direct read, 2026-08-15)

- **Workspace plumbing, complete.** `pnpm-workspace.yaml` already globs
  `apps/*`; `turbo.json` already defines `build` (outputs `dist/**`),
  `typecheck` and `test`, each `dependsOn ^build` — the pipeline was designed
  for exactly the build-to-dist shape below. Root `package.json` scripts
  (`test`→`turbo run test`, etc.) need no change. Root flat ESLint config
  (`eslint.config.mjs`) and Prettier cover `apps/**` with zero per-package
  config. `.gitignore:2-4` already ignores `.env` / `.env.*` except
  `.env.example` at any depth — `apps/gateway/.env` is covered.
- **The workspace-package pattern.** `packages/shared/package.json` +
  `packages/shared/tsconfig.json` (extends `../../tsconfig.base.json`,
  `include: ["src"]`, `typecheck` script). `tsconfig.base.json` is strict
  NodeNext ESM with `declaration` already on.
- **The shared stub to replace.** `packages/shared/src/index.ts` exports only
  `SHARED_PACKAGE`, referenced nowhere else in the repo (grepped) — safe to
  replace outright with the real contracts.
- **The n8n side of slice 3, done and verified.**
  `infra/n8n/workflows/ping.json` (webhook `POST /webhook/ping`, workflow id
  `XaviPing00000001`, active) answers
  `{"ok":true,"reply":"pong","receivedText":...,"at":...}` — probe verified
  today. The gateway only calls it.
- **Most of slice 4, already built.** `infra/.env.example:9-11` already has
  `TUNNEL_TOKEN` documented; `infra/docker-compose.yml:40-48` already has the
  `cloudflared` service under the `tunnel` profile with the dashboard-routing
  comment (`api.<domain> -> http://host.docker.internal:8787`);
  `infra/README.md` step 4 already documents creating the tunnel and both
  public hostnames, including `api.<domain>`. Slice 4 shrinks accordingly
  (see table) — do not re-create any of this.
- **A latent bug found while surveying** (flagging, per protocol):
  `infra/cloudflared/config.example.yml:11` routes `n8n.<your-domain>` to
  `http://localhost:5678` — but on this host 5678 is the _other_ stack's n8n
  (ENVIRONMENT.md gotcha #1); a host-native cloudflared must use `5679`.
  Small, in slice 4's blast radius, so slice 4 fixes it.
- **What does NOT exist:** no Fastify (or any) service anywhere in the repo
  (`apps/` holds only `.gitkeep`), no Vitest setup anywhere, no HTTP-client
  helper, no auth code, no env-loading helper. Nothing to reuse for those;
  nothing being duplicated by building them.

**Reference implementation:** `packages/shared/package.json` +
`packages/shared/tsconfig.json` — the only live workspace package; copy its
shape (name under `@xavi/`, `private`, `"type": "module"`, `typecheck`
script, tsconfig extending the base) and extend it with `build`/`test`/
`start`. For route/webhook behavior the reference is
`infra/n8n/workflows/ping.json` plus the literal curl in
`docs/bugs/ENVIRONMENT.md` ("How to get real data"). There is no service
sibling to imitate — that's explicit, not an omission.

**A runtime decision the builder must not re-litigate:** this machine runs
Node **22.14.0** (checked today; `.nvmrc` just says `22`), which does **not**
strip TypeScript types by default — `node src/server.ts` will not run.
Therefore: both packages compile with `tsc` to `dist/`, and the server runs
as `node dist/server.js`. This is zero extra dependencies and matches the
turbo pipeline that already exists. Consequences:

- `packages/shared` gains `"build": "tsc"` and its `exports` move from
  `./src/index.ts` to `{"types": "./dist/index.d.ts", "default": "./dist/index.js"}`;
  its tsconfig gains `rootDir: "src"`, `outDir: "dist"`. Turbo's
  `dependsOn: ["^build"]` then orders shared-build before gateway
  typecheck/test automatically — run checks via root `pnpm typecheck` /
  `pnpm test`, not bare `tsc` in the package, or `dist` may be stale/absent.
- Gateway source uses `.js` extensions on relative imports (NodeNext
  standard); Vitest handles that natively, no config file needed —
  colocated `*.test.ts` and a `"test": "vitest run"` script suffice.
- Env loading: `node --env-file=.env dist/server.js` (Node ≥20.6 built-in)
  in the `start` script — **no dotenv**.
- HTTP out (Ollama, n8n): global `fetch` + `AbortSignal.timeout(5000)` —
  **no axios/undici dep**.
- Body validation: Fastify's built-in JSON-schema (Ajv ships inside
  fastify) gives the 400 for missing/non-string `text` — **no type-provider
  or zod**; the spec's "minimal deps" line stays literally true:
  `fastify` + `vitest` are the only additions.

**Where the new code goes:** (file by file; slices below say when)

| Path                                                            | What                                                                                                                                                                                                                         |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/gateway/package.json`                                     | `@xavi/gateway`, private, ESM; deps `fastify`, `@xavi/shared` (`workspace:*`); devDeps `typescript`, `vitest`; scripts `build`/`typecheck`/`test`/`start`                                                                    |
| `apps/gateway/tsconfig.json`                                    | extends `../../tsconfig.base.json`; `rootDir: "src"`, `outDir: "dist"`, `include: ["src"]`                                                                                                                                   |
| `apps/gateway/.env.example`                                     | starts in slice 1 with `GATEWAY_BEARER_TOKEN` (comment: generate with `openssl rand -hex 32`); slice 2 adds `OLLAMA_URL`/`OLLAMA_MODEL`; slice 3 adds `N8N_WEBHOOK_BASE` — placeholders and defaults only, never real values |
| `apps/gateway/src/config.ts`                                    | reads env with the spec's defaults; fails fast at boot if `GATEWAY_BEARER_TOKEN` is unset                                                                                                                                    |
| `apps/gateway/src/auth.ts`                                      | bearer-check `preHandler`; generic 401 body, no hints                                                                                                                                                                        |
| `apps/gateway/src/app.ts`                                       | `buildApp(...)` Fastify factory: `/healthz`, `/command` with schema validation; takes intent-detection and skill-dispatch as injected functions so slices 2–3 plug in and tests can fake them (`app.inject`, no sockets)     |
| `apps/gateway/src/server.ts`                                    | entrypoint: config → `buildApp` → `listen({ port: 8787, host: "127.0.0.1" })`                                                                                                                                                |
| `apps/gateway/src/app.test.ts`                                  | slice 1 criteria via `app.inject`                                                                                                                                                                                            |
| `apps/gateway/src/intent.ts` + `intent.test.ts`                 | slice 2: Ollama `/api/chat` `format:"json"` call, prompt, parse, `unknown` fallback (fetch injected/faked in tests)                                                                                                          |
| `apps/gateway/src/skills.ts` + `skills.test.ts`                 | slice 3: typed registry (intent → webhook path) + n8n dispatcher with the 5s timeout and the 502 mapping                                                                                                                     |
| `packages/shared/src/index.ts`                                  | **modify** — replace the stub with the real contracts, grown per slice (see table); drop `SHARED_PACKAGE` (unreferenced)                                                                                                     |
| `packages/shared/package.json`, `packages/shared/tsconfig.json` | **modify** — build script + dist exports as described above (slice 1)                                                                                                                                                        |
| `apps/.gitkeep`                                                 | **delete** in slice 1 (directory stops being empty)                                                                                                                                                                          |
| `infra/cloudflared/config.example.yml:11`                       | **modify** in slice 4 — `5678` → `5679`                                                                                                                                                                                      |
| `infra/README.md`                                               | **modify** in slice 4 — gateway bring-up + the outside-the-network curl test                                                                                                                                                 |

**What NOT to create:** `infra/.env.example` entries for the gateway (its env
lives at `apps/gateway/.env`, already gitignored); any change to
`turbo.json` / `pnpm-workspace.yaml` / `.gitignore` / `eslint.config.mjs` /
`.github/workflows/ci.yml`; a vitest.config file (zero-config works); the
n8n ping workflow (exists, active, verified); dotenv, tsx, axios, zod,
`@fastify/bearer-auth`, any type provider (reasons above — each would need a
written justification the spec demands, and none clears that bar).

**Where it does NOT go:**

- Not `packages/gateway` — it's an app; `apps/*` is the settled layout.
- Contracts do not live inside `apps/gateway` — settled: `packages/shared`,
  so gateway and future iOS/n8n consumers change atomically (ADR-0001/0002).
- No dev-runner via Node type stripping (`node src/server.ts`) — ruled out:
  this host's 22.14.0 doesn't do it by default, and CI's floating
  `node-version: 22` would make behavior differ between machines.
- No standalone always-running dev server assumption in tests — tests use
  `app.inject`; the real socket only matters for the manual curl checks.

**Slices, with paths:** (same four as section 1; slices 1–3 unchanged in
scope, slice 4 recut smaller because most of it already exists in `infra/` —
that discovery is the reason, written above)

| #   | What it does                                                                                                                                                                                                                                                                                                                                                 | Files                                                                                                                                                                                                                                | Criteria it closes                                                                                                                                                                                     | State    |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| 1   | Gateway skeleton: `/healthz` no-auth + authenticated `/command` echoing `text` back in the shared response shape. Includes the shared-package build rework and first contracts (`CommandRequest`, `CommandResponse`).                                                                                                                                        | `apps/gateway/{package.json,tsconfig.json,.env.example}`, `apps/gateway/src/{config,auth,app,server}.ts`, `apps/gateway/src/app.test.ts`, modify `packages/shared/{package.json,tsconfig.json,src/index.ts}`, delete `apps/.gitkeep` | healthz 200; 401 no-leak; 400 on bad `text`; response typed from `packages/shared` (shape only — echo, no real intent yet); lint/typecheck/format green; `pnpm test` green; no secret in tracked files | accepted |
| 2   | Intent detection: `/command` calls Ollama (`format:"json"`), parses `{"intent","params"}`, any parse/shape failure → logged `unknown` (200, capability-listing reply, no n8n call). Adds `IntentDetection` type to shared.                                                                                                                                   | `apps/gateway/src/intent.ts`, `apps/gateway/src/intent.test.ts`, modify `app.ts` (wire real detector), `config.ts` + `.env.example` (`OLLAMA_URL`, `OLLAMA_MODEL`), `packages/shared/src/index.ts`                                   | full `{ok,intent,reply,skillResult?}` 200 shape; `unknown`/parse-failure fallback, never 500; ES + EN commands work, LLM reply mirrors input language                                                  | accepted |
| 3   | Skill registry + ping round trip: `ping` intent → real `POST {N8N_WEBHOOK_BASE}/ping`, response folded into `skillResult`; down/non-2xx/>5s → 502 `{ok:false,intent,error:"skill_unavailable"}`, no hang, no crash. Adds registry/skill-result types to shared.                                                                                              | `apps/gateway/src/skills.ts`, `apps/gateway/src/skills.test.ts`, modify `app.ts`, `config.ts` + `.env.example` (`N8N_WEBHOOK_BASE`), `packages/shared/src/index.ts`                                                                  | ping → n8n round trip into `skillResult`; 502 on down/non-2xx/timeout                                                                                                                                  | accepted |
| 4   | Tunnel docs, recut: infra `.env` shape and dashboard-hostname docs **already exist** — remaining work is the gateway bring-up + outside-network curl section in `infra/README.md`, the `config.example.yml` 5678→5679 fix, and a final pass that `.env.example` files carry placeholders only. Public-hostname verification stays user-gated (tunnel token). | modify `infra/README.md`, `infra/cloudflared/config.example.yml:11`, final review of `apps/gateway/.env.example`                                                                                                                     | no secret in any tracked file; definition-of-done curl documented (its live run is the user's, post tunnel-up)                                                                                         | accepted |

## 3. Construction — feature-builder

### Slice 1

**Summary for the reviewer:** Built the gateway skeleton (`/healthz` no-auth,
authenticated echo `/command`) plus the shared-package build rework the plan
prescribed. What I most likely broke: `@xavi/shared` now resolves from
`dist/`, not `src/` — anything running bare `tsc`/`vitest` inside a package
without turbo ordering (`pnpm typecheck`/`pnpm test` from the root) will see a
stale or missing `dist`; also note turbo's `test` task rebuilds only
_dependencies_, so `apps/gateway/dist` itself can lag behind `src` (vitest
runs from source and won't notice — my first live curl run hit exactly that).

**What was built:**

- `apps/gateway/package.json` — `@xavi/gateway`, ESM, deps `fastify` +
  `@xavi/shared` (workspace); devDeps `typescript`, `vitest`, **`@types/node`**
  (deviation, justified below); scripts `build`/`typecheck`/`test`/`start`
  (`start` uses `node --env-file=.env dist/server.js`, no dotenv).
- `apps/gateway/tsconfig.json` — extends the base, `rootDir: src`,
  `outDir: dist`.
- `apps/gateway/.env.example` — `GATEWAY_BEARER_TOKEN` placeholder with the
  `openssl rand -hex 32` comment. No real value anywhere; no `.env` was
  created (live checks passed the throwaway token inline via the environment).
- `apps/gateway/src/config.ts` — env loading, fails fast on missing/empty
  `GATEWAY_BEARER_TOKEN`; port/host hardcoded to the settled `127.0.0.1:8787`.
- `apps/gateway/src/auth.ts` — bearer check as an **`onRequest`** hook with a
  constant-time compare; 401 body is exactly `{"error":"unauthorized"}`.
- `apps/gateway/src/app.ts` — `buildApp()` factory: `GET /healthz`,
  `POST /command` with JSON-schema body validation (`text`: string,
  minLength 1) and an injected `handleCommand` seam defaulting to the echo
  handler. Ajv `coerceTypes: false` (see below).
- `apps/gateway/src/server.ts` — entrypoint, `listen({port: 8787, host:
"127.0.0.1"})`.
- `apps/gateway/src/app.test.ts` — 13 Vitest tests via `app.inject`: healthz,
  four 401 variants (missing header, wrong token, wrong scheme, wrong
  length), 401-beats-400 ordering, three 400 variants (missing/empty/
  non-string `text`), echo happy path, injected-handler seam, `loadConfig`
  fail-fast and defaults.
- `packages/shared/package.json` + `tsconfig.json` — build-to-dist rework
  exactly as section 2 prescribed (`exports` → `dist/index.js` +
  `dist/index.d.ts`, `build: tsc`, `rootDir`/`outDir`).
- `packages/shared/src/index.ts` — stub replaced with `CommandRequest` and
  `CommandResponse` (`{ok, intent, reply, skillResult?, error?}`).
- Deleted `apps/.gitkeep`.

**Why this way (deviations from section 2, each with its reason):**

- **`@types/node` added as a devDep** (not in the architect's dep list): the
  strict `tsc` build cannot see `Buffer`, `process` or `NodeJS.ProcessEnv`
  without it. Types-only, no runtime footprint; the "minimal deps" constraint
  reads as runtime deps (`fastify` + `vitest` remain the only ones).
- **Auth is an `onRequest` hook, not the `preHandler` section 2 mentions**:
  in Fastify's lifecycle `preHandler` runs _after_ schema validation, so an
  unauthenticated request with a bad body would answer 400 before auth.
  `onRequest` decides 401 before body parsing — the test "401 wins over
  validation" pins this.
- **One injected `handleCommand` seam instead of separate intent-detection +
  skill-dispatch injections**: slice 1 has nothing real to inject for either;
  a single `(text) => Promise<CommandResponse>` keeps the factory honest and
  slice 2 can split it when the second collaborator actually exists.
- **Ajv `coerceTypes: false`** on the Fastify instance: Fastify's default
  coercion turns `{"text": 42}` into `"42"` and would answer 200 where the
  criterion demands 400. Caught by the test suite, confirmed live.
- **`error?: string` included in `CommandResponse` now** (section 2 schedules
  it for slice 3): one optional field, avoids a third breaking rewrite of the
  shared contract. `intent` is `"echo"` until slice 2 — placeholder value,
  named in the type's doc comment.

**Verification:** (all from the repo root, 2026-08-15)

- `pnpm lint` ✓, `pnpm typecheck` ✓ (3 tasks), `pnpm format` ✓ ("All matched
  files use Prettier code style!"), `pnpm build` ✓, `pnpm test` ✓ — Vitest:
  `Tests  13 passed (13)`.
- Live, against `node dist/server.js` (fresh build) on `127.0.0.1:8787` with
  a throwaway token passed inline, then killed (port verified free after):
  - `GET /healthz` → `200 {"status":"ok"}`
  - no auth / wrong token → `401 {"error":"unauthorized"}` (nothing else in
    the body)
  - missing `text` → `400 … "body must have required property 'text'"`
  - empty `text` → `400 … "must NOT have fewer than 1 characters"`
  - `{"text":42}` → `400 … "body/text must be string"`
  - `{"text":"enciende la luz"}` → `200 {"ok":true,"intent":"echo","reply":"enciende la luz"}`
    (same for English input)

**Criteria it closes:** (slice-1 subset per the section 2 table)

- healthz 200 no-auth — closed (test + live curl above).
- 401 no-leak — closed; body is the constant `{"error":"unauthorized"}`, test
  asserts exact equality and absence of the token.
- 400 on missing/empty/non-string `text` — closed (tests + live curls).
- 200 response typed from `packages/shared` — closed **at echo level only**:
  shape `{ok, intent, reply}` compiled against `CommandResponse`; real
  `intent`/`skillResult` semantics arrive with slices 2–3.
- lint/typecheck/format green — closed.
- `pnpm test` green — closed.
- No secret in tracked files — closed: `.env.example` has placeholders only,
  no `.env` exists, the test token is a literal dummy string.

**Risks:**

- The `@xavi/shared` exports flip (src → dist): any future consumer or script
  bypassing turbo's `^build` ordering gets "cannot find module". Root
  commands are the safe path.
- Stale-`dist` gap: `pnpm test` green does **not** prove `dist/` is current
  (vitest transpiles from source). `pnpm build` before `pnpm start` or any
  live check. Worth remembering in slice 4's bring-up docs.
- pnpm 10 blocked esbuild's postinstall script (its default policy); vitest
  ran fine regardless on this machine. If tests ever fail with an esbuild
  binary error on a fresh clone, that's the knob (`pnpm approve-builds`) —
  user's call, not changed here.

**Tree state:** uncommitted, as the protocol requires.

### Slice 2

**Summary for the reviewer:** `/command` now detects intent via Ollama
(`/api/chat`, `format:"json"`) with an unknown-intent capability reply that a
**second, free-text LLM call** generates in the user's language. What I most
likely broke: `buildApp` no longer has a default handler — `handleCommand` is
now **required** and the slice-1 `echoCommandHandler` export is gone, so
anything that constructed `buildApp({bearerToken})` bare, or imported the echo
handler, breaks at compile time (I found and updated the only consumers:
`server.ts` and `app.test.ts` — but check I didn't miss one).

**What was built:**

- `apps/gateway/src/intent.ts` (new) — the whole slice-2 surface:
  - `KNOWN_INTENTS` registry (`ping` only, with a description) — slice 3
    wires dispatch to it; `UNKNOWN_INTENT = "unknown"`.
  - `makeIntentDetector` — one `/api/chat` call, `format: "json"`,
    `stream: false`, system prompt listing the registry and demanding ONLY
    `{"intent": ..., "params": {}}`. Every failure mode (fetch throws,
    non-2xx, response missing `message.content`, unparseable JSON, wrong
    shape, unregistered intent name) is logged via an injectable `warn` and
    collapses to `{intent: "unknown", params: {}}` — the detector never
    throws, so `/command` can never 500 from here.
  - `parseDetection` — exported pure parser; non-object/non-string-intent →
    undefined; missing or non-object `params` coerced to `{}`.
  - `makeUnknownReplyGenerator` — second Ollama call, free text (no
    `format`), prompting a polite capability-listing reply **in the user's
    language**; on any failure falls back to a static bilingual (EN/ES) line
    built from the registry. Never throws.
  - `makeIntentCommandHandler` — glues both into the `CommandHandler` seam:
    unknown → LLM/fallback reply, `ok: true`, no n8n; detected intent → an
    acknowledgement reply (dispatch is slice 3), no n8n either.
- `apps/gateway/src/intent.test.ts` (new) — 22 tests, all with injected fake
  `fetch`: request shape (URL/model/format/stream/messages), parser matrix,
  every fallback path (each asserting the `warn` spy), handler call-count
  assertions (**exactly one** outbound call on detected intent, two on
  unknown, i.e. no n8n dispatch), and two end-to-end `app.inject` tests —
  including "model garbage still answers 200 unknown, never 500".
- `apps/gateway/src/app.ts` — `handleCommand` made required,
  `echoCommandHandler` removed (see summary).
- `apps/gateway/src/server.ts` — wires `makeIntentCommandHandler` with the
  config's Ollama settings.
- `apps/gateway/src/config.ts` + `.env.example` — `OLLAMA_URL` (default
  `http://localhost:11434`) and `OLLAMA_MODEL` (default `qwen2.5:7b`); empty
  string counts as unset. Placeholder values only in `.env.example`.
- `apps/gateway/src/app.test.ts` — adapted to the required handler (fake echo
  provided by the test file) + 2 new `loadConfig` cases (defaults, overrides).
- `packages/shared/src/index.ts` — added `IntentDetection` (`{intent, params}`)
  per the plan; `CommandResponse.intent` doc comment updated (no shape change).

**Why this way (deviations from the plan, each with its reason):**

- **A second LLM call for the unknown reply** (the plan's prompt answers ONLY
  `{"intent","params"}`, which leaves no language-mirroring reply to use):
  the section 1 criterion demands the reply mirror ES/EN "when it comes from
  the LLM", and the only LLM-generated reply in this slice is the unknown
  one. Keeping the classifier prompt exactly as settled and adding a separate
  free-text call satisfies both criteria without loosening the strict-JSON
  contract. Cost: one extra Ollama round trip on the unknown path only.
- **Ollama timeout is 30s, not the 5s the plan mentions for HTTP out**: the
  5s limit is the slice-3 n8n criterion; a cold `qwen2.5:7b` load measured
  **21.5s** on this machine today — a 5s timeout would turn every cold-start
  command into `unknown`. Injectable (`timeoutMs`) and documented in the
  option's doc comment.
- **Unknown-reply prompt was tuned against the live model** (documented in a
  code comment): the first phrasing ("answer in the same language...") was
  ignored by qwen2.5:7b — a live English input got a Spanish reply with no
  capability list. Rewritten as three numbered requirements with a bilingual
  language clause: 4/4 correct on ES/EN probes, then re-verified through the
  gateway.
- **Parse failures log through an injectable `warn` defaulting to
  `console.warn`**, not the Fastify logger: the handler is constructed before
  the app exists (`server.ts` wiring order). Stderr still lands in the
  service's output; tests assert the logging via the injected spy.

**Verification:** (all from the repo root, 2026-08-15)

- `pnpm lint` ✓, `pnpm typecheck` ✓, `pnpm format` ✓ ("All matched files use
  Prettier code style!"), `pnpm build` ✓, `pnpm test` ✓ — Vitest:
  `Tests  36 passed (36)` (14 app + 22 intent).
- Live, against `node dist/server.js` (fresh build, throwaway token inline,
  real Ollama on `localhost:11434`, `qwen2.5:7b`), then killed — port 8787
  verified free after:
  - `{"text":"ping"}` → `200 {"ok":true,"intent":"ping","reply":"Intent \"ping\" recognized. Skill dispatch is not wired up yet."}`
  - `{"text":"haz un ping para ver si estás vivo"}` → same, `intent: "ping"` (ES detection works).
  - `{"text":"what is the weather like in Barcelona today?"}` →
    `200 intent "unknown"`, reply in **English**: "I'm sorry, but I can't
    check the current weather in Barcelona today yet. Currently, I can only
    perform a health check by saying \"ping\" …"
  - `{"text":"¿puedes encender la luz del salón, por favor?"}` →
    `200 intent "unknown"`, reply in **Spanish**: "Lo siento, pero no puedo
    hacer eso aún. Actualmente solo puedo realizar comprobaciones de estado
    como el \"ping\"."
  - First cold call took 21.5s (model load) and still succeeded — the 30s
    timeout choice, exercised for real.
- No test data was seeded anywhere (no n8n touched, nothing persisted).

**Criteria it closes:** (slice-2 subset per the section 2 table)

- Full `{ok, intent, reply, skillResult?}` 200 shape — closed: handler
  compiled against `CommandResponse`; live 200 bodies above; `skillResult`
  legitimately absent until slice 3.
- Unknown / parse-failure fallback, never 500, no n8n call, capability-listing
  reply, failure logged — closed: fallback matrix unit-tested with the warn
  spy asserted on every path; call-count tests prove no second/n8n request on
  the detected-intent path; end-to-end test pins "garbage model output → 200
  unknown"; live unknown replies list `ping`.
- ES + EN commands work; LLM reply mirrors input language — closed at the
  level checkable here: live round trips above (ES→Spanish reply, EN→English
  reply, both detect `ping` in both languages). Caveat for the record: an LLM
  is sampled, not deterministic — a rerun can phrase things differently;
  criteria-relevant behavior (language + capability list) was verified on
  live runs after prompt tuning, and the deterministic fallback is bilingual.
- The slice-1 criteria (healthz/401/400) stay green — the 14 app tests still
  pass unchanged apart from the handler seam.
- Not closed here (slice 3): ping → n8n round trip into `skillResult`; 502
  `skill_unavailable` handling.

**Risks:**

- `buildApp` signature change (required `handleCommand`, `echoCommandHandler`
  gone) — compile-time breakage for any un-spotted consumer.
- The unknown path now costs up to two LLM round trips; with a cold model
  that's ~40s worst-case before the client sees an answer. No timeout budget
  criterion exists for Ollama in section 1, but the reviewer should know the
  latency envelope.
- Prompt behavior is model-specific (tuned on `qwen2.5:7b`); switching
  `OLLAMA_MODEL` may degrade language mirroring — the fallback keeps the
  contract, but replies could stop mirroring. Worth a line in slice 4's docs.
- `docs/features/BOARD.md` and this dossier had pre-existing Prettier
  violations (left by earlier chain sessions — HEAD's BOARD.md passes, the
  working-tree one didn't); `pnpm format` only went green after I formatted
  them. Both are files this protocol obliges me to edit, so I formatted those
  two files only — no repo-wide `format:fix` was run.

**Tree state:** uncommitted, as the protocol requires.

### Slice 3

**Summary for the reviewer:** A detected `ping` now round-trips through the
real n8n webhook (`skillResult` carries its body, `reply` its literal "pong");
down/non-2xx/>5s all answer 502 `skill_unavailable`. What I most likely broke:
`makeIntentCommandHandler` now **requires** a `dispatch` option (same
breaking-signature move as slice 2's `handleCommand`) and `KNOWN_INTENTS` is
no longer its own list but an alias of `SKILLS` in `skills.ts` — check I
updated every constructor call (`server.ts`, `intent.test.ts`) and that no
other code assumed `KNOWN_INTENTS` was independent; also `app.ts` now maps
**any** `ok: false` handler result to HTTP 502, which is correct per the
shared contract today but is a global route behavior, not a ping-specific one.

**What was built:**

- `apps/gateway/src/skills.ts` (new) — the slice-3 surface:
  - `SKILLS` — the single canonical registry (`SkillDescriptor[]`: name,
    description, `webhookPath`). `intent.ts`'s `KNOWN_INTENTS` now aliases it,
    so a recognizable intent without a webhook route can't exist (the lists
    can't drift). Only entry: `ping` → `POST {N8N_WEBHOOK_BASE}/ping`.
  - `makeSkillDispatcher` — POSTs the `SkillRequest` (`{text, params}`) with
    `AbortSignal.timeout(5000)` (the criterion's budget, exported as
    `DEFAULT_SKILL_TIMEOUT_MS`). Down, timeout, non-2xx, 2xx-but-not-JSON and
    unroutable-intent all collapse to `{ok:false, error:"skill_unavailable"}`
    — logged via injectable `warn`, never thrown.
  - `replyForSkillResult` (skill's own `reply` string when present, generic
    bilingual line otherwise) and `skillUnavailableReply` (static bilingual
    502 reply — not LLM-generated, allowed by the criterion).
- `apps/gateway/src/skills.test.ts` (new) — 22 tests with injected fake
  fetch: registry/alias identity, URL joining, request shape, result folding,
  the whole failure matrix (each asserting the warn spy), and a **real
  timeout-path test** (a hanging fetch that honors the abort signal, 20ms
  budget — the abort machinery itself is exercised, not simulated).
- `apps/gateway/src/intent.ts` — `KNOWN_INTENTS = SKILLS`;
  `makeIntentCommandHandler` takes required `dispatch`, replaces the slice-2
  acknowledgement with the real dispatch: success folds `skillResult` +
  skill reply, failure returns `{ok:false, intent, error, reply}`. Unknown
  path untouched (still never dispatches).
- `apps/gateway/src/app.ts` — `/command` maps `ok: false` → `reply.code(502)`
  (per the shared contract, `ok: false` ⇔ dispatch failure).
- `apps/gateway/src/config.ts` + `.env.example` — `N8N_WEBHOOK_BASE`
  (default `http://localhost:5679/webhook`; the example file warns 5678 is
  the other stack's). `server.ts` wires `makeSkillDispatcher` in.
- `apps/gateway/src/intent.test.ts` — handler tests grew the fake dispatcher:
  dispatch called exactly once with `{text, params}` on detection, never on
  unknown/fallback; new e2e 200-with-`skillResult` and e2e-502 tests.
- `apps/gateway/src/app.test.ts` — new route-level `ok:false → 502` test;
  `loadConfig` tests extended for the new key.
- `packages/shared/src/index.ts` — added `SkillDescriptor`, `SkillRequest`
  and the `SKILL_UNAVAILABLE` error-code constant.

**Why this way (deviations, each with its reason):**

- **One registry instead of two** (section 2 sketched `KNOWN_INTENTS` in
  `intent.ts` and a separate intent→path map in `skills.ts`): a registered
  intent missing its route would be a representable bug; merging them makes
  it unrepresentable. `skills.test.ts` pins `KNOWN_INTENTS === SKILLS`.
  Import direction is `intent.ts → skills.ts` only — no cycle.
- **`SkillDescriptor` lives in shared** (per section 2's "registry/skill-result
  types to shared"), which makes `@xavi/shared` carry its first runtime export
  (`SKILL_UNAVAILABLE`) — it was types-only before. Harmless: it already
  built to `dist/` since slice 1.
- **`intent.ts` was modified though section 2's slice-3 file list omits it**:
  the slice-2 code explicitly left the acknowledgement branch with a "slice 3
  replaces this" comment — the glue point is there, not in `app.ts`.
- **2xx-with-non-JSON body counts as `skill_unavailable`**: the criterion
  only names down/non-2xx/timeout, but the skill contract is JSON and folding
  garbage into `skillResult` silently would hide a broken skill. Logged,
  502, documented in a code comment.
- **A dispatcher `dispatch` on an unroutable intent answers 502, not a
  throw**: unreachable while the registry is shared (the detector only lets
  registered intents through), but misconfiguration must degrade, not crash.

**Verification:** (all from the repo root, 2026-08-15)

- `pnpm lint` ✓, `pnpm typecheck` ✓, `pnpm format` ✓ ("All matched files use
  Prettier code style!"), `pnpm build` ✓, `pnpm test` ✓ — Vitest:
  `Tests  62 passed (62)` (16 app + 24 intent + 22 skills).
- Live, `node dist/server.js` (fresh build, throwaway token inline, real
  Ollama and real n8n on their ENVIRONMENT.md addresses), killed after each
  scenario — port 8787 verified free at the end:
  - `{"text":"ping, are you alive?"}` → `200 {"ok":true,"intent":"ping","reply":"pong","skillResult":{"ok":true,"reply":"pong","receivedText":"ping, are you alive?","at":"2026-08-15T07:30:49.147Z"}}`
    — the real n8n round trip, `receivedText` proving the gateway forwarded
    the original text.
  - `{"text":"haz un ping a ver si sigues vivo"}` → same shape (ES detection
    → real dispatch).
  - `{"text":"¿puedes poner música en el salón?"}` → `200 intent "unknown"`,
    Spanish capability reply — no dispatch (pinned by tests' call counts).
  - **502, all three causes, live** (never stopping the real n8n — each via
    `N8N_WEBHOOK_BASE` on a throwaway boot):
    - down (dead port 59999): 502 `{ok:false,intent:"ping",error:"skill_unavailable",reply:"…bilingual…"}`
      in 2.6s; log: `webhook unreachable … TypeError: fetch failed`.
    - non-2xx (real n8n, wrong path → 404): 502 in 2.0s; log:
      `webhook answered HTTP 404`.
    - timeout (throwaway local socket that accepts and never answers): 502 in
      7.0s total (~2s Ollama + **5s abort**), no hang; log:
      `webhook unreachable (down, or no answer within 5000ms): TimeoutError`.
- Cleanup: every throwaway process killed (gateway boots + the hanging-socket
  helper), ports 8787/59998 verified free; nothing was seeded in n8n (the
  ping workflow is stateless); the throwaway token grepped — nowhere in the
  tree.
- One EADDRINUSE mishap mid-verification (second boot while the first was
  alive) made the first 404-case curl actually hit the dead-port server; the
  case was re-run cleanly and the log line above is from the clean run.

**Criteria it closes:** (slice-3 subset per the section 2 table)

- ping → n8n round trip folded into `skillResult` — closed: live EN and ES
  round trips above through the real webhook; e2e test pins the folded body
  and the literal "pong" reply.
- 502 `{ok:false, intent, error:"skill_unavailable"}` on down/non-2xx/timeout,
  no hang, no crash — closed: each cause verified live (evidence above) and
  unit-tested including a real abort-path test; the server answered normal
  requests again after every failure scenario.
- `unknown` never calls n8n — still closed: dispatch-never-called assertions
  on both unknown paths, plus the live unknown round trip.
- Slice-1/2 criteria stay green: full suite passes; healthz/401/400 tests
  unchanged; live healthz checked at boot.
- lint/typecheck/format/test green — closed (outputs above).
- No secret in tracked files — closed: `.env.example` gained only the
  `N8N_WEBHOOK_BASE` placeholder; no `.env` exists; token grepped clean.

**Risks:**

- `makeIntentCommandHandler` signature (required `dispatch`) — compile-time
  breakage for any un-spotted consumer.
- `app.ts` maps every `ok:false` to 502. If a future slice introduces an
  `ok:false` that isn't a gateway-upstream failure, that mapping needs
  revisiting (documented in the code comment).
- `@xavi/shared` now has a runtime export; consumers importing it need the
  built `dist` (same stale-dist gotcha slice 1 recorded).
- The generic `replyForSkillResult` fallback line ("completed / completado")
  and `skillUnavailableReply` are static bilingual, not language-mirrored —
  the criterion explicitly allows literal skill replies, but the reviewer
  should judge that reading, not inherit it.

**Tree state:** uncommitted, as the protocol requires.

### Slice 4

**Summary for the reviewer:** Docs + config only, no runtime code touched:
fixed the `config.example.yml` 5678→5679 latent bug and added the gateway
bring-up + definition-of-done curl (plus the latency envelope) to
`infra/README.md`. What I most likely broke: nothing executable — the risk is
a documentation lie: the local curl outputs in README step 6 were **not**
re-run live this session (the permission system blocked booting the gateway),
they rest on slice-3's live evidence; and the latency numbers (~20–40 s cold,
~60 s worst case) are point-in-time measurements from slice 2's runs.

**What was built:**

- `infra/cloudflared/config.example.yml` — the section 2 latent bug:
  `n8n.<your-domain>` now routes to `http://localhost:5679` (was 5678, the
  _other_ stack's n8n), with a comment explaining why 5679 is correct for a
  host-native cloudflared and why the containerized one in compose keeps
  `http://n8n:5678` (container port) — so nobody "fixes" either back.
- `infra/README.md` — intro updated (a fresh machine needs two gitignored env
  files now, `infra/.env` + `apps/gateway/.env`); new **step 6** in bring-up:
  build-first warning (the stale-`dist` gotcha slice 1 recorded), token
  generation via `openssl rand -hex 32` into the gitignored `.env`,
  `pnpm --filter @xavi/gateway start`, local healthz + `/command` curls, the
  spec's definition-of-done curl against `https://api.<domain>/command`
  (explicitly the user's to run, post tunnel-up), and the latency envelope
  (~20–40 s cold model load, ~60 s unknown-path worst case) + the
  model-switch caveat — the two standing reviewer findings slice 4's docs
  were asked to carry.
- Final placeholder pass on `infra/.env.example` and
  `apps/gateway/.env.example` — both read in full, both already carry
  placeholders only, **no changes needed** (that's the pass's result, not an
  omission).

**Why this way (deviations and scope calls, each with its reason):**

- **Step 6 appended, steps 1–5 untouched**: minimal diff, and by step 6 the
  tunnel (step 4) is already up, which is the order the outside-network curl
  needs anyway. Renumbering to put the gateway before the tunnel was ruled
  out — bigger diff, no dependency gained.
- **CI still does not run `pnpm test`** (standing reviewer finding since
  slice 1): deliberately NOT fixed — slice 4's criteria are "no secret in any
  tracked file" and "definition-of-done curl documented"; touching
  `.github/workflows/ci.yml` is outside them and section 2 lists CI under "do
  NOT touch". Left for the user/a future feature, re-flagged here.
- **`docs/bugs/ENVIRONMENT.md` is now stale** (gateway row says "does not
  exist yet"; "Checks that exist" says tests "none yet"; "Live patterns" says
  none) — the protocol forbids agents modifying it mid-flight, so flagged,
  not fixed. It deserves a refresh once this feature lands.

**Verification:** (all from the repo root, 2026-08-15)

- `./infra/probe.sh` first: n8n 5679 up, Ollama 11434 up, ping webhook
  answering — environment matches the map.
- `pnpm lint` ✓, `pnpm typecheck` ✓, `pnpm format` ✓ ("All matched files use
  Prettier code style!"), `pnpm build` ✓, `pnpm test` ✓ — Vitest:
  `Tests 62 passed (62)`. All run **after** every edit of this slice.
- **5679 correctness cross-checked, not assumed**: `docker-compose.yml:19`
  publishes `127.0.0.1:5679:5678`, so a host-native cloudflared (the
  example config's scenario) must dial the host port 5679, while the
  compose-internal comment (`n8n.<domain> -> http://n8n:5678`,
  `docker-compose.yml:44`) is container-port and stays correct as-is.
- **Documented commands cross-checked against code**: `start` is
  `node --env-file=.env dist/server.js` (`apps/gateway/package.json:10`);
  bind is `127.0.0.1:8787` (`apps/gateway/src/config.ts:33-34`). I attempted
  to verify step 6 literally (throwaway token in the gitignored `.env`, boot,
  curl) — the permission system blocked starting the server, consistent with
  the no-starting-services rule, so the local curl examples rest on slice 3's
  live builder+reviewer evidence; no gateway code changed in this slice, so
  that evidence still binds. The throwaway `apps/gateway/.env` I seeded for
  the attempt was **deleted** (verified gone; token file shredded from
  scratchpad); nothing listens on 8787 before or after (curled healthz: no
  answer).
- **No-secrets pass**: `git check-ignore` confirms `infra/.env` and
  `apps/gateway/.env` are ignored; both `.env.example` files read — only
  `n8n.example.com`, an empty `TUNNEL_TOKEN=` and the
  `replace-with-output-of-…` placeholder; the whole `infra/` diff grepped for
  token-like strings — only placeholder mentions (`<your token>`, comment
  text). `gitleaks` binary is not installed on this machine, so the local
  scan could not be run — CI runs it on push and the pre-commit hook
  (`.githooks/pre-commit`) is in place.

**Criteria it closes:** (slice-4 subset per the section 2 table)

- No secret (bearer token, tunnel token) in any tracked file — closed:
  evidence above; the one caveat, stated rather than hidden, is that the
  local gitleaks binary is absent so the final word is CI's.
- Definition-of-done curl documented, live run user-gated — closed at the
  documentation level (README step 6 carries the literal
  `https://api.<domain>/command` curl and the local rehearsal). The
  **public-hostname run itself stays pending manual testing** — steps for
  the user, in order: (1) tunnel token into `infra/.env` as `TUNNEL_TOKEN`,
  (2) `docker compose --profile tunnel up -d` from `infra/`, (3) both public
  hostnames added in the Zero Trust dashboard per the step-4 table (n8n one
  behind Access), (4) gateway up per step 6, (5) the step-6 curl from
  outside the network (phone off Wi-Fi is enough).

**Risks:**

- The latency numbers documented are this machine's, measured on slice-2
  day; a different model or hardware shifts them. They're framed as
  "to expect", not as a contract.
- `config.example.yml` is now host-specific in the same way the rest of the
  repo is (5679 is right wherever this compose file runs; the comment says
  why). Anyone porting the example to a stock single-n8n host must read the
  comment.
- README's intro now promises `apps/gateway/.env` is all a fresh machine
  needs beyond `infra/.env` — true today; a future service adding a third
  env file must remember this sentence.

**Tree state:** uncommitted, as the protocol requires.

## 4. Review — feature-reviewer

### Slice 1

**Verdict first: accepted.** Every slice-1 criterion verified against section
1 as written, by independent test run and live curl, not by reading the
builder's transcript.

**Criteria, one by one:** (2026-08-15, all from the repo root)

- `GET /healthz` → `200 {"status":"ok"}` no auth — **met** (live curl).
- 401 on missing/wrong bearer, no leak — **met**: body is exactly
  `{"error":"unauthorized"}` in every variant tried (no header, wrong token,
  wrong scheme, wrong length); also verified 401 wins over body parsing
  (malformed JSON without auth → 401, not a parser error).
- 400 on missing/empty/non-string `text` — **met** (live: all three, each
  with a short Ajv message, no stack).
- 200 shaped `{ok, intent, reply}` typed from `packages/shared` — **met at
  the echo level this slice claims** (ES and EN inputs echo back; real
  intent semantics are slices 2-3, as the section 2 table scopes it).
- lint/typecheck/format green — **met**, re-run myself; typecheck/build/test
  additionally re-run with `turbo --force` so a cached result couldn't mask
  anything: 5/5 tasks green, `Tests 13 passed (13)`.
- `pnpm test` green — **met** (same forced run).
- No secret in tracked files — **met**: `git check-ignore` confirms
  `apps/gateway/.env` and `dist/`/`node_modules/` are ignored while
  `.env.example` is tracked; no `.env` exists; `.env.example` carries only
  the placeholder; the test token is a literal dummy string.

Remaining section 1 criteria (Ollama intent, n8n dispatch, 502 handling,
language mirroring by the LLM) stay open for slices 2-3 — not judged here.

**What broke nearby:** (how I looked) No graph in this repo (ENVIRONMENT.md),
so by grep and diff. Grepped `SHARED_PACKAGE` (the old stub export) across
the tree excluding node_modules/dist: zero code consumers — only the dossier
mentions it, so the exports flip from `src/` to `dist/` orphaned nobody.
Grepped `@xavi/shared` importers: only the gateway. Grepped `shared/src`
deep-path imports: none. `git status` shows no file outside the architect's
declared blast radius was touched (turbo.json, workspace yaml, .gitignore,
eslint config, CI, infra/ all untouched). Started from the builder's own
"most likely broke" flag: confirmed `turbo.json` orders `^build` before
typecheck/test, and the forced root run proves the ordering works. Lockfile
additions are only fastify/vitest transitive deps. Boot without
`GATEWAY_BEARER_TOKEN` fails fast with a clear message — verified live.

**States left unbuilt:** No UI, so loading/mobile don't apply. Checked live:
malformed JSON → 400; wrong content-type → 400; empty body → 400; 12 MB
payload → 413 (Fastify's default 1 MB bodyLimit — no hang, no crash); missing
env at boot → clean throw. Findings, not blockers: (a) CI runs
lint/typecheck/format but **not** `pnpm test` — the Vitest suite only runs
locally; worth adding to CI when convenient (mind the builder's pnpm-10
esbuild-postinstall note). (b) The auth hook is registered per-route on
`/command`, not app-wide; with two routes that satisfies "every route except
/healthz" literally, but slices 2-4 must remember to attach it to any new
route (unknown routes currently answer an unauthenticated 404). (c) The
schema has no `maxLength` on `text`; the 1 MB bodyLimit is the only cap —
fine for a single-client assistant, noted for the record.

**Does it duplicate something that existed?** No. Checked against section 2's
"what NOT to create": no dotenv/tsx/axios/zod/type-provider added
(dependencies are exactly `fastify` + `@xavi/shared`; devDeps `typescript`,
`vitest`, plus `@types/node`, a types-only deviation the builder justified in
writing and I accept — runtime deps stay at the spec's minimum); no
vitest.config file; no touch on the n8n workflow or infra. The shared stub
was replaced, not shadowed — contracts live in `packages/shared` as settled.

**Verdict:** accepted — all seven slice-1 criteria met with independent
evidence; no regression found where I looked; three findings recorded above,
none of them return-worthy.

**For the user:** You can now run the gateway locally: `pnpm build`, put a
token in `apps/gateway/.env` (copy `.env.example`, `openssl rand -hex 32`),
`pnpm --filter @xavi/gateway start`, then `curl http://127.0.0.1:8787/healthz`
and `curl -X POST http://127.0.0.1:8787/command -H "Authorization: Bearer
<token>" -H 'content-type: application/json' -d '{"text":"hola"}'` — it
authenticates and echoes. Intent detection arrives with slice 2.

### Slice 2

**Verdict first: accepted.** Every slice-2 criterion verified against section
1 as written — checks re-run myself (turbo `--force`, uncached) and live round
trips through the real Ollama, not the builder's transcript.

**Criteria, one by one:** (2026-08-15, from the repo root)

- Full `{ok, intent, reply, skillResult?}` 200 shape typed from
  `packages/shared` — **met**: live 200 bodies match `CommandResponse`
  (`packages/shared/src/index.ts`); `skillResult` legitimately absent until
  slice 3; handler compiled against the shared type (typecheck green).
- Unknown / parse-failure → `intent: "unknown"`, 200, capability-listing
  reply, **no** n8n call, failure logged, never a 500 — **met**: live EN
  ("capital of France") and ES ("apaga las luces") both answered 200
  `unknown` with a reply listing `ping`; live boot with `OLLAMA_URL` pointed
  at a dead port answered 200 with the static bilingual fallback (both
  failures in the log, no 500); unit matrix covers non-2xx / network error /
  garbage output / wrong shape / unregistered intent, each asserting the warn
  spy. No-n8n verified by evidence, not trust: grep of `apps/gateway/src`
  finds 5679/webhook only in comments, and the call-count tests pin exactly
  one outbound call (Ollama) on a detected intent, two on unknown.
- ES + EN both work; `reply` mirrors input language when LLM-generated —
  **met** live: "ping, are you alive?" and "haz un ping a ver si sigues vivo"
  both → `intent: "ping"`; unknown EN input → English reply, unknown ES input
  → Spanish reply, both listing the `ping` capability. (LLM is sampled —
  phrasing varies per run; language + capability list held on every probe.)
- lint/typecheck/format green — **met**, re-run myself; typecheck/build/test
  re-run with `--force`: 5/5 tasks, `Tests 36 passed (36)` (14 app + 22
  intent).
- `pnpm test` green — **met** (same forced run).
- No secret in tracked files — **met**: no `.env` exists,
  `git check-ignore` covers `apps/gateway/.env`, `.env.example` adds only
  `OLLAMA_URL`/`OLLAMA_MODEL` placeholders, review's throwaway token was
  inline-env only (grepped: nowhere in the tree).
- Slice-1 criteria did not regress — **re-verified live**: `/healthz` →
  `200 {"status":"ok"}`; missing header and wrong token → 401 exactly
  `{"error":"unauthorized"}`; missing `text` → 400 short Ajv message.
- Deviation judged against the literal criteria: the 30s Ollama timeout does
  **not** contradict section 1 — the only 5s budget written there is the n8n
  webhook criterion (slice 3, untouched); no criterion sets an Ollama
  latency budget. Cold-load measured 21.5s by the builder, so 5s would have
  broken the ES/EN criterion on every cold start. Deviation accepted as
  documented.

**What broke nearby:** (how I looked) No graph in this repo (ENVIRONMENT.md).
Started from the builder's own flag: grepped `buildApp` and
`echoCommandHandler` across `apps`+`packages` excluding node_modules/dist —
consumers are exactly `server.ts`, `app.test.ts`, `intent.test.ts`, all
updated; no orphaned import of the removed echo handler. Grepped
`IntentDetection`: only `intent.ts` consumes it. `git status` shows nothing
outside the declared blast radius (gateway files, shared index, dossier,
board; lockfile delta is slice 1's). `apps/gateway/package.json` gained no
new dependency in this slice. Port 8787 verified free after each boot;
incidentally observed the server fail fast and clean on EADDRINUSE.

**States left unbuilt:** No UI — loading/mobile/permissions don't apply
beyond the bearer auth already covered. Checked: Ollama down → 200 static
fallback (above); model garbage → 200 unknown (test); empty model reply →
fallback (test). Findings, not blockers: (a) unknown-path worst case is two
sequential 30s-capped LLM calls (~60s ceiling, ~40s observed cold) — no
criterion bounds it, but slice 4's docs should mention the latency envelope;
(b) `truncate()` counts UTF-16 units and can split a surrogate pair in a log
line — logging-only, cosmetic; (c) slice-1 finding stands: CI still doesn't
run `pnpm test`.

**Does it duplicate something that existed?** No. Against section 2's list:
no dotenv/axios/zod/type-provider added (deps unchanged since slice 1), no
vitest.config, no touch on the n8n workflow or infra, registry stayed in
`intent.ts` for slice 3 to wire, contracts stayed in `packages/shared`. The
second free-text LLM call is new code inside the slice's own file, justified
in writing by the language-mirroring criterion — not a duplication.

**Verdict:** accepted — all slice-2 criteria met with independent evidence;
slice-1 behavior re-verified live; no regression found where I looked; three
findings recorded, none return-worthy.

**For the user:** The gateway now understands what you ask instead of echoing
it: `{"text":"haz un ping"}` answers `intent: "ping"`, and anything it can't
do yet answers `intent: "unknown"` with a polite reply in your own language
listing what Xavi can currently do — even if Ollama is down, it degrades to a
bilingual fallback instead of an error. Try it: `pnpm build`, token in
`apps/gateway/.env`, `pnpm --filter @xavi/gateway start`, then POST
`{"text":"ping, are you alive?"}` and `{"text":"apaga las luces"}` to
`/command` (first call after a while may take ~20-40s while the model loads).
Dispatching `ping` to n8n arrives with slice 3.

### Slice 3

**Verdict first: accepted.** Every slice-3 criterion verified against section
1 as written — root checks re-run myself with `turbo --force` (uncached), and
every live scenario re-executed against the built gateway on `127.0.0.1:8787`
with my own throwaway inline token, including all three 502 causes, without
ever touching the real n8n.

**Criteria, one by one:** (2026-08-15, from the repo root)

- ping → gateway calls the existing n8n `POST /webhook/ping` and folds its
  response into `skillResult` — **met** live, EN and ES: "ping, are you still
  alive?" and "hazme un ping para comprobar que sigues vivo" both →
  `200 {"ok":true,"intent":"ping","reply":"pong","skillResult":{"ok":true,"reply":"pong","receivedText":"<original text>",...}}`
  through the real Ollama and the real n8n; `receivedText` echoing my exact
  input proves the round trip is real, not canned. E2e test pins the folded
  body.
- n8n down / non-2xx / >5s → `502 {ok:false, intent, error:"skill_unavailable"}`,
  no hang, no crash — **met**, all three causes reproduced live myself, each
  on a throwaway boot via `N8N_WEBHOOK_BASE` (the real n8n never stopped):
  dead port 59999 → 502 in 2.3s, log "webhook unreachable … fetch failed";
  real n8n with a bogus path (404) → 502 in 2.2s, log "webhook answered HTTP
  404"; my own hanging socket on 59998 (accepts, never answers) → 502 in 6.9s
  total (~1.9s Ollama + **5s abort**, the criterion's bound), log
  "TimeoutError". `/healthz` answered after every failure — no crash, port
  clean. The suite additionally has a real abort-path test, and the ping
  webhook answered normally after all of it (re-curled).
- `unknown` → 200, no n8n call — still **met**: live EN ("weather in
  Girona") and ES ("apaga la luz de la cocina") both answered 200
  `intent:"unknown"` with a language-mirrored capability reply and no
  `skillResult`; the dispatch-never-called assertions pin the no-call claim,
  and grep confirms no n8n address in the code path outside config/comments.
- ES + EN work, `reply` mirrors input language when LLM-generated — **met**
  live in both directions (English question → English reply, Spanish →
  Spanish, both listing `ping`); the ping skill's literal "pong" reply is
  explicitly allowed by the criterion. The static bilingual 502/fallback
  replies are not LLM-generated, so the mirroring clause doesn't bind them —
  I judged that reading myself against the criterion's own parenthetical,
  and concur with the builder.
- lint/typecheck/format green — **met**, re-run myself; typecheck/build/test
  re-run uncached (`turbo --force`): 4/4 build+typecheck tasks,
  `Tests 62 passed (62)` (16 app + 24 intent + 22 skills).
- `pnpm test` green — **met** (same forced run).
- No secret in tracked files — **met**: `.env.example` carries only the
  `N8N_WEBHOOK_BASE` placeholder (with the 5678-is-not-ours warning); no
  `.env` exists; my throwaway token grepped — nowhere in the tree.
- Slice-1/2 non-regression — **re-verified live**: `/healthz` →
  `200 {"status":"ok"}`; missing header and wrong token → 401 exactly
  `{"error":"unauthorized"}`; missing `text` → 400 short Ajv message;
  unknown-intent path (slice 2's surface) exercised live above.

**What broke nearby:** (how I looked) No graph in this repo (ENVIRONMENT.md).
Started from the builder's own flags: grepped `makeIntentCommandHandler`,
`KNOWN_INTENTS`, `makeSkillDispatcher`, `SkillDispatcher` and
`SKILL_UNAVAILABLE` across `apps`+`packages` excluding node_modules/dist —
consumers are exactly `server.ts`, `intent.test.ts`, `skills.test.ts`, all
updated; `skills.test.ts` pins `KNOWN_INTENTS === SKILLS` so the alias can't
drift silently. `@xavi/shared` importers are still only the six gateway
source/test files — its first runtime export (`SKILL_UNAVAILABLE`) orphans
nobody, and the stale-dist gotcha didn't bite because my forced build
refreshed `dist` before the live boots. `git status` shows nothing outside
the declared blast radius (gateway, shared, dossier, board, lockfile from
slice 1). Gateway deps unchanged: `fastify` + `@xavi/shared`, devDeps
`typescript`/`vitest`/`@types/node` — slice 3 added zero dependencies. The
real n8n ping webhook re-verified healthy after all my failure scenarios.
Builder's EADDRINUSE mishap: irrelevant to the tree (a test-session accident,
re-run cleanly); I hit no port conflicts and verified 8787/59998 free at the
end.

**States left unbuilt:** No UI — loading/mobile don't apply; auth (the
no-permissions state) re-verified above. Error states are this slice's whole
point and all three are covered. Findings, not blockers: (a) `app.ts` maps
**every** `ok:false` handler result to 502 — correct under today's contract
(`ok:false` ⇔ dispatch failure, documented in the shared type), but it's
route-global; a future non-upstream `ok:false` would need that mapping
revisited (builder flagged it; I confirm the code comment is there).
(b) The unknown-with-n8n-down combination was not live-tested (unknown never
dispatches, so it's covered by construction plus the call-count tests) — noted
for completeness. (c) Standing findings from slices 1-2 remain open: CI still
doesn't run `pnpm test`; the unknown path's ~60s worst-case latency envelope
belongs in slice 4's docs.

**Does it duplicate something that existed?** No. Against section 2: the
registry landed in `skills.ts` with `intent.ts` aliasing it — one list, not
the two section 2 sketched; that's a merge, not a duplication, justified in
writing and pinned by a test. Contract types went to `packages/shared` as
prescribed. No new deps, no vitest.config, no touch on the n8n workflow or
infra (git status clean there). The `intent.ts` modification outside section
2's slice-3 file list is the declared deviation: the slice-2 glue point
(the "slice 3 replaces this" acknowledgement branch) lived there, so the
omission was the plan's, not scope creep — verified by reading the code.

**Verdict:** accepted — all slice-3 criteria met with independent live
evidence; slice-1/2 behavior re-verified; no regression found where I looked;
findings above, none return-worthy. Slice 4 (tunnel docs) remains — the
feature stays in construction, not delivered.

**For the user:** El gateway ya hace el viaje completo: le mandas
`{"text":"hazme un ping"}` (o en inglés) y él detecta la intención con el
modelo local, llama al webhook real de n8n y te devuelve
`{"ok":true,"intent":"ping","reply":"pong","skillResult":{...}}` con la
respuesta del workflow dentro. Y si n8n está caído, responde mal o tarda más
de 5 segundos, contesta un 502 limpio con `error: "skill_unavailable"` en
lugar de colgarse — lo que no reconoce sigue respondiendo 200 con la lista de
lo que sí sabe hacer, en tu idioma.

Para probarlo a mano: `pnpm build`, token en `apps/gateway/.env` (copia
`.env.example`, `openssl rand -hex 32`), `pnpm --filter @xavi/gateway start`,
y `curl -X POST http://127.0.0.1:8787/command -H "Authorization: Bearer
<token>" -H 'content-type: application/json' -d '{"text":"ping, are you
alive?"}'` — verás el `skillResult` de n8n dentro de la respuesta. Queda el
slice 4 (documentación del túnel) para poder hacer esto mismo desde fuera de
casa.

### Slice 4

**Verdict first: accepted.** Both slice-4 criteria met, every documented
claim cross-checked against the code it describes, and — the gap the builder
had to leave open — README step 6 was **rehearsed live by this review,
literally as written**: gitignored `.env` from `.env.example`, throwaway
`openssl rand -hex 32` token, `pnpm --filter @xavi/gateway start`, both
documented curls against the real Ollama + n8n. The docs don't lie.

**Criteria, one by one:** (2026-08-15, from the repo root; slice-4 subset per
the section 2 table)

- No secret (bearer token, tunnel token) in any tracked file — **met**:
  `git check-ignore -v` covers both `infra/.env` and `apps/gateway/.env`
  (`.gitignore:2`); neither file exists in the tree; both `.env.example`
  files read in full — only `n8n.example.com`, empty `TUNNEL_TOKEN=` and the
  `replace-with-output-of-openssl-rand-hex-32` placeholder; the whole diff
  grepped for token-like strings — only placeholder text, `<your token>`
  curl examples and pnpm-lock integrity hashes. My rehearsal token lived
  only in the gitignored `.env` and the scratchpad, both deleted (verified
  gone), gateway process killed, port 8787 verified refusing connections.
  Same caveat the builder recorded: no local gitleaks binary, so the final
  word is CI's + the pre-commit hook.
- Definition-of-done curl documented, live run user-gated — **met, and
  stronger than documented-only**: README step 6 carries the literal
  `https://api.<domain>/command` curl. I executed its local rehearsal
  end-to-end following the README's own commands: `/healthz` →
  `200 {"status":"ok"}`; the documented
  `{"text":"ping, are you alive?"}` curl → exactly the output the README
  promises (`{"ok":true,"intent":"ping","reply":"pong","skillResult":{…,"receivedText":"ping, are you alive?"}}`,
  10 s warm-ish — inside the documented ~20–40 s envelope); the
  definition-of-done body `{"text":"hazme un ping"}` → same shape (ES
  classification live); wrong token → 401. The public-hostname leg stays
  **pending manual testing by the user** (tunnel token), as section 1
  scopes it — not approved here, listed below.
- Root checks — **met**, re-run myself: `pnpm lint` ✓, `pnpm format` ✓
  ("All matched files use Prettier code style!"), `turbo run build typecheck
test --force` (0 cached) → 5/5 tasks, `Tests 62 passed (62)`.

**Documented claims vs. code (the review a docs slice actually needs):**
`start` script is `node --env-file=.env dist/server.js`
(`apps/gateway/package.json`) — matches the README's inline comment; bind is
`127.0.0.1:8787` (`apps/gateway/src/config.ts:33-34`) — matches; the 5679
fix cross-checked against `infra/docker-compose.yml:19`
(`127.0.0.1:5679:5678`) and ENVIRONMENT.md gotcha #1 — a host-native
cloudflared must dial 5679, while the compose comment's `http://n8n:5678`
(line 44) is container-port and correctly left alone; the example config's
new comment says exactly that, so neither gets "fixed" back. Latency numbers
are framed as "to expect", and my one live datapoint (10 s) sits inside them.

**What broke nearby:** (how I looked) No graph in this repo (ENVIRONMENT.md).
`git diff --stat` + `git status`: this slice touched only `infra/README.md`,
`infra/cloudflared/config.example.yml`, the dossier and BOARD.md — nothing
outside the declared blast radius (docker-compose.yml, `infra/.env.example`,
CI, gateway code all untouched, per git status). The config.example.yml diff
read in full: 5678→5679 plus the three comment lines, nothing else. The whole
README re-read top to bottom for coherence with the new step 6: steps 1–5
unchanged; step 4's hostname table (`api.<domain>` →
`http://host.docker.internal:8787`) agrees with step 6's phrasing and with
the example config; the pre-existing "What runs where" table already listed
the gateway and is now fulfilled rather than contradicted; the intro's
"two gitignored env files" claim is true today (grepped: no third `.env`
consumer exists). `./infra/probe.sh` run before the rehearsal: n8n 5679 up,
Ollama 11434 up, ping webhook answering — environment matched the map before
I touched anything.

**States left unbuilt:** Docs/config slice — empty/loading/error/mobile
don't apply. The no-permissions state (wrong token → 401) re-verified live
through the README's own flow. Findings, not blockers: (a) standing since
slice 1: **CI still doesn't run `pnpm test`** — correctly left out (outside
the criteria, section 2 lists CI under do-NOT-touch), but it's now a
three-slice-old finding that deserves its own small feature; (b)
**`docs/bugs/ENVIRONMENT.md` is stale** (gateway "does not exist yet", tests
"none yet", live patterns "none") — the builder rightly didn't touch it and
neither did I (protocol: agents in flight don't modify it); it needs the
user (or a fresh `/forja-init`) to refresh it now that this feature lands,
otherwise the next chain session pays the drift; (c) README step 6 documents
the happy path only — no troubleshooting for EADDRINUSE or a stale `dist`,
though the build-first warning covers the one trap that actually bit.

**Does it duplicate something that existed?** No. Section 2's discovery
("most of slice 4 already built") was respected: `TUNNEL_TOKEN` docs stayed
in `infra/.env.example` (untouched), the dashboard-hostname table stayed in
step 4 (untouched), docker-compose stayed untouched; step 6 references step
4 instead of repeating it. The only overlap — the openssl/token/start
instructions also live in the slice-1/2/3 "For the user" notes — is dossier
prose, not repo docs; in the repo the bring-up now lives in exactly one
place.

**Verdict:** accepted — both criteria met with independent live evidence,
the builder's untested gap closed by this review's own rehearsal, no
regression found where I looked, three findings recorded, none
return-worthy. **All four slices are now accepted → FEAT-001 is
`delivered`.** The one item that stays open is not a slice criterion: the
public-hostname run, user-gated by design (section 1 scoped it out of the
agents' hands), listed below as the user's steps.

**For the user:** Xavi ya tiene su "cerebro" mínimo completo — la Fase 1 del
roadmap. Puedes mandarle una orden en texto plano (en español o en inglés) y
él la autentica con tu token, detecta la intención con el modelo local,
dispara el workflow de n8n que corresponde y te devuelve la respuesta
estructurada; lo que aún no sabe hacer lo contesta con educación en tu
idioma, listando lo que sí sabe, y si n8n falla responde un error limpio en
vez de colgarse. Todo corre en tu máquina: el único punto público será el
túnel de Cloudflare, y ese último paso es tuyo porque requiere tu token.

Para probarlo en local ahora mismo: sigue el paso 6 del README de infra
(compilar, generar el token con `openssl rand -hex 32`, arrancar el gateway
y los dos curls que ahí aparecen — el primero contra `/healthz`, el segundo
mandando `{"text":"ping, are you alive?"}`; verás el `pong` de n8n dentro de
`skillResult`). Para cerrar la definición de hecho de la Fase 1 desde fuera
de casa, en orden: (1) tu token del túnel en el `.env` de infra como
`TUNNEL_TOKEN`; (2) `docker compose --profile tunnel up -d` desde infra;
(3) en el dashboard de Zero Trust, los dos hostnames públicos de la tabla
del paso 4 — el de n8n detrás de Cloudflare Access, el de `api.<dominio>`
apuntando a `http://host.docker.internal:8787`; (4) el gateway arrancado
según el paso 6; (5) desde una red externa (el móvil sin Wi-Fi vale), el
curl a `https://api.<dominio>/command` con tu bearer token y
`{"text":"hazme un ping"}` — la primera llamada tras un rato puede tardar
20–40 s mientras carga el modelo. Dos pendientes que anoto para ti: el CI
aún no ejecuta los tests (los cuatro slices lo arrastran como hallazgo), y
el mapa de entorno de `docs/bugs/` se quedó anticuado con esta entrega —
merece un refresco antes de la siguiente fase.
