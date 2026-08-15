# Xavi Assistant

A personal, self-hosted life assistant — think Jarvis, built incrementally. Xavi runs on my own hardware, uses local AI models, and automates everyday tasks: checking email, summarizing my day, and eventually responding to voice commands from a native iOS app.

> **Status:** Planning / Phase 0. See the [Roadmap](docs/ROADMAP.md).

## What it does (and will do)

- **Today:** nothing yet — the project is being bootstrapped.
- **Soon:** receive a text command over HTTPS, figure out the intent with a local LLM, and trigger the right automation (n8n workflow).
- **Later:** a native iOS app that transcribes voice **on-device** (audio never leaves the phone) and sends only text to the assistant.

## Design principles

1. **Local-first.** AI models run on my own machine via Ollama. No cloud inference, no third-party AI APIs.
2. **Privacy by default.** Voice is transcribed on-device. Only text travels over the network, always through an authenticated Cloudflare Tunnel.
3. **Public showcase, private data.** This repo is meant to be publishable. No secrets, no personal data, no credentials — ever. Workflows and configs are exported sanitized.
4. **Minimal, audited dependencies.** Every package is chosen deliberately.

## Architecture at a glance

```
[iOS app / CLI / curl]
    voice → text (on-device)
         │  text + auth token
         ▼  Cloudflare Tunnel
[Gateway service]           TypeScript/Fastify — the router/brain
         │  intent detection (local LLM via Ollama)
         ▼
[n8n workflows]             email, calendar, and future skills
```

Full details in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Key decisions are recorded as ADRs in [docs/adr/](docs/adr/).

## Repository layout

```
apps/
  gateway/     TypeScript API service (the assistant's brain/router)
  ios/         Native iOS app, Swift (Phase 3)
packages/
  shared/      Shared TypeScript types and API contracts
infra/         docker-compose (n8n), cloudflared config, sanitized n8n workflow exports
docs/          Architecture, roadmap, ADRs
```

## Project management

- Phases and progress: [docs/ROADMAP.md](docs/ROADMAP.md)
- Decisions: [docs/adr/](docs/adr/)
- How features and bugs are built: [docs/DEVELOPMENT-WORKFLOW.md](docs/DEVELOPMENT-WORKFLOW.md) — agent chains from [jakos-ai-toolkit](https://github.com/alejandro-devop/jakos-ai-toolkit)
- Task tracking: GitHub Issues + Milestones (one milestone per phase) once the repo is published.

## Getting started

```bash
git config core.hooksPath .githooks   # secret-scan hook (needs gitleaks installed)
pnpm install
pnpm lint && pnpm typecheck && pnpm format
```

Infrastructure (n8n, Ollama, the tunnel): see [infra/README.md](infra/README.md).

## License

TBD before publishing (likely MIT).
