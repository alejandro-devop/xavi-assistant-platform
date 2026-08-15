# ADR-0002: TypeScript for services and tooling

**Status:** Accepted — 2026-08-14

## Context

The gateway service mainly routes: authenticate, classify intent via Ollama's HTTP API, call n8n webhooks, shape responses. Python was considered for its AI ecosystem; the heavy AI lifting here, however, is done by Ollama and n8n, not by library code in the service.

## Decision

**TypeScript everywhere** in the services and tooling: the gateway (Fastify), shared packages, and scripts. Node is also n8n's native ecosystem, which keeps mental overhead low.

## Consequences

- One language and one toolchain across the monorepo (the iOS app excepted, see ADR-0003).
- API contracts are shared as TypeScript types in `packages/shared` — no drift between server and clients.
- If a future skill genuinely needs Python-only libraries, it can be added as an isolated worker behind its own small API, without changing the gateway.
