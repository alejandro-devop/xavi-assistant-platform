# ADR-0001: Monorepo with pnpm workspaces and Turborepo

**Status:** Accepted — 2026-08-14

## Context

The project spans several deliverables (gateway API, shared types, iOS app, infrastructure config, docs) that evolve together and share contracts. It is also meant to be published as a single coherent showcase.

## Decision

One repository for everything. TypeScript packages are managed with **pnpm workspaces** and orchestrated with **Turborepo** (task caching, `apps/*` + `packages/*` convention). Non-TypeScript parts (the Xcode project in `apps/ios`, `infra/`) live in the same repo but outside pnpm's management.

## Consequences

- Shared types between gateway and future clients change atomically in one PR.
- One CI pipeline, one place to audit dependencies and scan for secrets.
- Turborepo is a dev-time dependency only; if it ever feels heavy for the repo's size it can be dropped with little cost, since pnpm workspaces do the structural work.
- The iOS app is built with Xcode on macOS while the rest builds anywhere Node runs; CI covers TypeScript first, iOS builds are added later (Phase 3).
