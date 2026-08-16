# Infrastructure

Everything runs on a single Linux host. Ollama runs natively (ADR-0004); the
gateway (`apps/gateway`) runs natively too; n8n and the Cloudflare Tunnel run
in Docker via [docker-compose.yml](docker-compose.yml); the only public
entrance is the tunnel. A fresh machine needs Docker, Ollama, Node ≥ 22 +
pnpm, this repo and two gitignored env files (`infra/.env`,
`apps/gateway/.env`) — nothing else.

## Prerequisites

| Tool             | Why                                                                      |
| ---------------- | ------------------------------------------------------------------------ |
| Docker + compose | runs n8n and cloudflared                                                 |
| Ollama (native)  | local LLM inference (`ollama pull qwen2.5:7b` or similar instruct model) |
| Node ≥ 22 + pnpm | the TypeScript workspace                                                 |
| gitleaks         | local secret scan in the pre-commit hook (CI scans regardless)           |

## Bring-up from scratch

1. **Repo hooks** (once per clone):

   ```bash
   git config core.hooksPath .githooks
   ```

2. **n8n**:

   ```bash
   cd infra
   cp .env.example .env   # fill in N8N_HOST
   docker compose up -d
   ```

   First visit to `http://localhost:5679` creates the owner account. Workflow
   data persists in the `n8n_data` volume. The port is 5679 (not n8n's default 5678) so it can coexist with other n8n instances on the same host, and it is
   bound to `127.0.0.1` — the LAN never sees it.

3. **Ollama** — install natively, then pull an instruct model:

   ```bash
   ollama pull qwen2.5:7b
   ```

   The gateway (Phase 1) talks to it on `localhost:11434`; n8n workflows reach
   it at `http://host.docker.internal:11434`.

4. **Cloudflare Tunnel** (needs a domain on Cloudflare): in the Zero Trust
   dashboard, Networks → Tunnels → create a tunnel, copy its token into
   `infra/.env` as `TUNNEL_TOKEN`, and add the public hostnames:

   | Hostname       | Service                                      |
   | -------------- | -------------------------------------------- |
   | `n8n.<domain>` | `http://n8n:5678`                            |
   | `api.<domain>` | `http://host.docker.internal:8787` (Phase 1) |

   Then:

   ```bash
   docker compose --profile tunnel up -d
   ```

   (A locally-managed tunnel with `cloudflared tunnel create` + a config file
   works too — see [cloudflared/config.example.yml](cloudflared/config.example.yml) —
   but the token route is what the compose file automates.)

5. **Cloudflare Access in front of n8n** (required — the editor holds OAuth
   credentials for your email/calendar): Zero Trust → Access → Applications →
   add `n8n.<domain>`, with a policy allowing only your email (One-time PIN is
   enough). The gateway hostname does NOT go behind Access — it authenticates
   with its own bearer token so the iOS app can reach it.

6. **Gateway** (the Phase 1 "brain", `apps/gateway`) — from the repo root:

   ```bash
   pnpm install
   pnpm build   # ALWAYS build before starting: `start` runs the compiled
                # dist/, and green tests do NOT prove dist/ is fresh
   cp apps/gateway/.env.example apps/gateway/.env
   openssl rand -hex 32   # paste the output into apps/gateway/.env
                          # as GATEWAY_BEARER_TOKEN — never into a tracked file
   pnpm --filter @xavi/gateway start   # node --env-file=.env dist/server.js
   ```

   The server binds `127.0.0.1:8787`; the tunnel is its only public entrance.
   Check it locally first:

   ```bash
   curl http://localhost:8787/healthz
   curl -X POST http://localhost:8787/command \
     -H "Authorization: Bearer <your token>" \
     -H 'content-type: application/json' \
     -d '{"text":"ping, are you alive?"}'
   # → {"ok":true,"intent":"ping","reply":"pong","skillResult":{...}}
   ```

   Then, with the tunnel up (step 4) and `api.<domain>` routed to
   `http://host.docker.internal:8787`, run the same command from outside the
   network — this is Phase 1's definition of done:

   ```bash
   curl -X POST https://api.<domain>/command \
     -H "Authorization: Bearer <your token>" \
     -H 'content-type: application/json' \
     -d '{"text":"hazme un ping"}'
   ```

   Latency to expect: the first command after idle can take ~20–40 s while
   Ollama loads the model, and a command the gateway cannot classify makes up
   to two LLM calls (30 s cap each) — worst case ~60 s cold. Give your client
   a generous timeout before concluding it hangs. Prompts are tuned on
   `qwen2.5:7b`; switching `OLLAMA_MODEL` keeps the JSON contract (worst case
   the reply degrades to a static bilingual fallback) but language mirroring
   may suffer.

## What runs where

| Piece             | Address                                   | Public?                              |
| ----------------- | ----------------------------------------- | ------------------------------------ |
| n8n editor        | `localhost:5679` → `https://n8n.<domain>` | via tunnel, behind Cloudflare Access |
| Ollama            | `localhost:11434`                         | never exposed                        |
| Gateway (Phase 1) | `localhost:8787` → `https://api.<domain>` | via tunnel, bearer token             |

## Rules

- Ports are bound to `127.0.0.1` — nothing is exposed to the LAN or the
  internet except through the tunnel.
- Secrets live in `infra/.env` (gitignored) and n8n's encrypted credential
  store. Workflow exports go to `infra/n8n/workflows/` **sanitized**.
- The n8n image tag: `latest` is fine while the project is single-user;
  pin it if reproducibility starts to matter more than updates.

## Workflows

Sanitized workflow exports live in [n8n/workflows/](n8n/workflows/) and are the
versioned source of truth. To load one into a running n8n (no editor needed):

```bash
docker cp n8n/workflows/ping.json xavi-assistant-n8n-1:/tmp/wf.json
docker exec xavi-assistant-n8n-1 n8n import:workflow --input=/tmp/wf.json
docker exec xavi-assistant-n8n-1 n8n update:workflow --id=XaviPing00000001 --active=true
docker restart xavi-assistant-n8n-1
```

Test the `ping` workflow:

```bash
curl -s -X POST http://localhost:5679/webhook/ping -H 'content-type: application/json' -d '{"text":"hello"}'
```

Webhook nodes in exports must carry a `webhookId` — without it, activation
silently skips registering the production URL.
