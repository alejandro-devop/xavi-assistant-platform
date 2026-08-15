# Development workflow

This project is built with the help of [jakos-ai-toolkit](https://github.com/alejandro-devop/jakos-ai-toolkit), a set of Claude Code agent chains where **no agent trusts the previous one**: the one who plans doesn't build, the one who builds doesn't close, and the one who reviews doesn't touch code. Both plugins are installed at user scope from the toolkit's marketplace.

## Features — the `forja` chain

Every roadmap item beyond trivial chores goes through the feature chain:

```
feature-analyst → feature-architect → feature-builder → feature-reviewer
  scope, testable    what already          builds one           checks against the
  criteria, slices   exists, where the     vertical slice,      original criteria,
                     new code goes         doesn't commit       hunts collateral damage
```

- The **architect only runs** when a feature introduces a new concept; features that hang off existing concepts go straight to the builder. The decision is recorded with its reason.
- Work happens in **vertical slices**, each reviewed before the next starts.
- Acceptance criteria are written **before** building and are never rewritten to match what got built.
- Feature dossiers live in `docs/features/`, tracked in `docs/features/BOARD.md`.

## Bugs — the `cazabugs` chain

```
bug-reporter → bug-detective → bug-hunter → bug-auditor
  records and    reproduces and    fixes, doesn't    tries to break the fix
  prioritizes    finds the cause   close             through a different path
```

- Priority is decided by one question — _can the person finish what they came to do?_ — not by technical severity.
- Bug dossiers live in `docs/bugs/`, queued in `docs/bugs/QUEUE.md`.
- `/bugs-github` imports GitHub issues labeled `bug` into the queue; when a fix is pushed, `issues-close.sh --close` closes the corresponding issues.

## Ground rules shared by both chains

- **State lives on disk**, not in conversation context: any chain can stop between steps and resume in a new session.
- **Agents never commit.** Changes stay in the working tree until reviewed/audited; commits are made by the human.
- **Agents never start or stop services.** The environment (n8n, Ollama, the gateway) is brought up by the human; agents read `ENVIRONMENT.md` to know where everything runs.
- `ENVIRONMENT.md` (one shared map per project) is created by `/cazabugs-init` / `/forja-init` and must be refreshed whenever the environment changes.

## Setup status

- [x] `cazabugs` and `forja` installed (user scope, from `jakos-ai-toolkit` marketplace)
- [ ] Toolkit ≥ 0.2.0 (the English rewrite — [PR #1](https://github.com/alejandro-devop/jakos-ai-toolkit/pull/1)) merged and updated locally (`claude plugin marketplace update jakos-ai-toolkit` + reinstall both plugins)
- [ ] `/cazabugs-init` — run at the end of Phase 0, once n8n/Ollama/tunnels exist and there is a real environment to map
- [ ] `/forja-init` — run before Phase 1 construction starts (it will reuse the `ENVIRONMENT.md` created by cazabugs)

As of toolkit 0.2.0 the whole toolkit — agent prose, protocols, dossiers — works in English, so everything it produces in this repo is English too.
