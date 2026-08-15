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

## Running a phase

Phases are executed by the chains, not by the planning assistant. Each phase
has a detailed spec in [specs/](specs/) — goal, context, decisions already
taken (never re-asked), behavior, out-of-scope, user-gated steps — ending
with a **kickoff prompt** ready to paste.

To run one:

1. Open a fresh Claude Code session in this repo. Any capable model works —
   phase execution is designed to run on an economical model; the deep
   planning already lives in the specs and protocols.
2. Type **`/next-phase`** (or paste the spec's kickoff prompt — same thing,
   longhand). The command picks the right phase, checks preconditions, and
   resumes an in-progress chain from disk instead of restarting it.
3. The session releases the agents one link at a time: analyst → (your
   decisions) → architect if needed → builder → reviewer per slice. It
   pauses between links; state lives on disk, so you can stop and resume in
   another session at any point.
4. You make the commits. Agents never do.

The chain's subagents come from the **`forja` plugin, not from this repo**:
on a machine that hasn't run this project before (e.g. the Mac for Phase 3),
install the toolkit first:

```bash
claude plugin marketplace add alejandro-devop/jakos-ai-toolkit
claude plugin install forja@jakos-ai-toolkit
claude plugin install cazabugs@jakos-ai-toolkit
```

## Setup status

- [x] `cazabugs` and `forja` installed at user scope, **v0.2.0** (English rewrite)
- [x] `/cazabugs-init` + `/forja-init` — run 2026-08-15: protocols, queue and board in `docs/bugs/` + `docs/features/`, shared map in `docs/bugs/ENVIRONMENT.md`, probe at `infra/probe.sh`

The toolkit — agent prose, protocols, dossiers — works in English, so everything it produces in this repo is English too.
