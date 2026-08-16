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

4. **Cloudflare Tunnel** — the only public entrance. It needs a domain whose
   nameservers point at Cloudflare (adding the domain in the dashboard prints
   the two to set at your registrar; the domain must read **Active** before
   any hostname resolves). Then, from scratch:

   1. Dashboard → **Zero Trust** (first visit asks for a team name and a
      plan — Free is enough) → **Networks → Tunnels → Create a tunnel** →
      type **Cloudflared** → name it `xavi-assistant`.
   2. The install screen shows a command containing a long `--token eyJhIjoi…`.
      Ignore the command — compose runs cloudflared for you. Copy the token
      alone into `infra/.env` as `TUNNEL_TOKEN` (gitignored; never anywhere
      else).
   3. In the tunnel's **Public Hostname** tab, add both routes:

      | Hostname       | Type | URL                        |
      | -------------- | ---- | -------------------------- |
      | `n8n.<domain>` | HTTP | `localhost:5679`           |
      | `api.<domain>` | HTTP | `localhost:8787` (Phase 1) |

      The DNS records are created for you. Both URLs are `localhost` because
      the `cloudflared` service runs with `network_mode: host` — the gateway
      binds `127.0.0.1`, which the docker bridge cannot reach.

   ```bash
   docker compose --profile tunnel up -d
   ```

   `docker compose logs -f cloudflared` should reach the line about a
   registered tunnel connection, and the dashboard should show it **HEALTHY**.

   (A locally-managed tunnel with `cloudflared tunnel create` + a config file
   works too — see [cloudflared/config.example.yml](cloudflared/config.example.yml) —
   but the token route is what the compose file automates.)

5. **Cloudflare Access in front of n8n** (required — the editor holds OAuth
   credentials for your email/calendar, and an unclaimed n8n lets anyone create
   its owner account): Zero Trust → **Access controls** → Applications →
   Create new application → Self-hosted and private → Add public hostname
   `n8n.<domain>`, with a policy allowing only your email (One-time PIN is
   enough). Until that policy exists, keep the hostname out of the tunnel's
   ingress rather than serving it unprotected. The gateway hostname does NOT go
   behind Access — it authenticates with its own bearer token so the iOS app
   can reach it.

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
   `http://localhost:8787`, run the same command from outside the network —
   this is Phase 1's definition of done:

   ```bash
   curl -X POST https://api.<domain>/command \
     -H "Authorization: Bearer <your token>" \
     -H 'content-type: application/json' \
     -d '{"text":"hazme un ping"}'
   ```

   When that curl misbehaves: `502` means the gateway process isn't running
   (or `cloudflared` lost `network_mode: host`); `530`/`1033` means the tunnel
   itself isn't connected; a DNS failure means the domain isn't Active yet.
   A one-time-PIN prompt on `n8n.<domain>` is Access working as intended —
   `api.<domain>` must NOT be behind Access, since the iOS app cannot pass a
   browser login and authenticates with its bearer token instead.

   Latency to expect: the first command after idle can take ~20–40 s while
   Ollama loads the model, and a command the gateway cannot classify makes up
   to two LLM calls (30 s cap each) — worst case ~60 s cold. Give your client
   a generous timeout before concluding it hangs. Prompts are tuned on
   `qwen2.5:7b`; switching `OLLAMA_MODEL` keeps the JSON contract (worst case
   the reply degrades to a static bilingual fallback) but language mirroring
   may suffer.

## Keeping it running

The gateway and the tunnel are the two pieces that must outlive a terminal
(the iOS app in Phase 3 talks to them from outside the house). Both run as
**systemd user units** — no root anywhere:

```bash
loginctl enable-linger $USER   # user services start at boot, survive logout
```

```bash
cp infra/systemd/*.service ~/.config/systemd/user/   # then edit the paths
```

```bash
systemctl --user enable --now xavi-gateway xavi-cloudflared
```

`systemctl --user status xavi-gateway` and `journalctl --user -u xavi-gateway -f`
are how you read them afterwards. Remember the units run `dist/`: after
changing gateway code, `pnpm build && systemctl --user restart xavi-gateway`.

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
