# ADR-0004: Local-first infrastructure behind Cloudflare Tunnels

**Status:** Accepted — 2026-08-14

## Context

The assistant handles deeply personal data (email, calendar, voice commands). Cloud inference would mean shipping that data to third parties, and cloud hosting adds cost and surface area for a personal project. A capable Linux machine is available to run models locally.

## Decision

Everything runs on the owner's Linux host:

- **Ollama** natively on the host for LLM inference (GPU access without container friction).
- **n8n** in Docker for automations, with its encrypted credential store holding all third-party OAuth secrets.
- **Cloudflare Tunnels** as the only ingress: `api.<domain>` → gateway (bearer-token auth), `n8n.<domain>` → n8n editor (behind Cloudflare Access). No inbound ports are opened on the network.

## Consequences

- No inference or hosting costs; personal data never leaves the host except through explicitly configured integrations (e.g. Google APIs called by n8n).
- Availability is tied to one machine being on — acceptable for a personal assistant, revisit if that changes.
- The public repo can never contain tunnel credentials, tokens, or n8n exports with embedded secrets; enforced by gitignore rules + gitleaks (see ARCHITECTURE.md, Security model).
- Migration to a server later is a config move, not a redesign: every component is already containerized or self-contained.
