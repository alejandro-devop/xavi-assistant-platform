# Phase 2 spec — First real skills

> Feed this to the `feature-analyst` when Phase 1 is delivered. Each skill is
> its own feature (two dossiers, run one at a time) — they share the n8n +
> gateway plumbing but ship independently.

## Goal

Xavi does two genuinely useful things every day, end to end via `curl` (and
later the iOS app): summarize today's agenda and review the inbox.

**Definition of done (from the roadmap):** "what's on my plate today?" and
"check my email" both work end-to-end via curl.

## Context

Phase 1 delivered the gateway: bearer auth, intent detection via Ollama,
skill registry dispatching to n8n webhooks (`ping` proves the loop). This
phase adds two real skills and their intents.

## Decisions already taken (do not re-ask)

| Decision                    | Value                                                                                                                             | Why                                                            |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Where skills live           | n8n workflows triggered by webhook, one per skill                                                                                 | gateway stays a thin router (ARCHITECTURE.md)                  |
| Where summarization happens | inside the n8n workflow, calling Ollama at `http://host.docker.internal:11434` (HTTP Request node)                                | keeps the gateway skill-agnostic; the workflow owns its prompt |
| External credentials        | ONLY in n8n's encrypted credential store (Google OAuth) — never in the repo, never in gateway env                                 | public repo, ADR-0004                                          |
| Workflow versioning         | sanitized exports in `infra/n8n/workflows/`, imported via the CLI recipe in `infra/README.md`                                     | established pattern                                            |
| New intents                 | `agenda` (what's on today) and `email_review` (summarize inbox) added to the registry; `unknown` reply updated to list all skills | Phase 1 registry design                                        |
| Reply language              | replies come out in the user's language (the summarization prompt says so explicitly)                                             | the user speaks Spanish; showcase readers may not              |

## Skill A — Today's agenda

- n8n workflow `agenda`: webhook → Google Calendar node (today's events,
  primary calendar) → Ollama summarization → respond.
- Reply: natural-language rundown ordered by time — event, time range,
  location/link if present. No events → say so pleasantly, not with an error.
- Summary stays under ~120 words: it will be spoken aloud in Phase 4.

## Skill B — Email review

- n8n workflow `email-review`: webhook → Gmail node (unread from the last
  24h, cap at 25) → Ollama summarization → respond.
- Reply: prioritized summary — what needs action first, then FYIs; sender +
  gist per item, grouped when repetitive (newsletters). Nothing unread → say
  so.
- Privacy rule: email bodies never leave the machine (Ollama is local) and
  never get logged by gateway or workflow beyond n8n's own execution log.

## Out of scope

Replying to or sending email, creating/moving calendar events, marking
mail read, multiple accounts, proactive notifications (Phase 4), any UI.

## User-gated steps

- Creating the Google Cloud OAuth client and connecting the Gmail and
  Google Calendar credentials in the n8n editor (the user's accounts, the
  user's clicks). Agents document the exact steps; the user performs them.
- Deciding which calendar/account if there are several (analyst should list
  this as a user decision only if discovery shows more than one).

## Constraints

- Workflow exports MUST be sanitized (no credential ids with secrets, no
  personal email addresses in pinned test data) — gitleaks and the reviewer
  both check.
- Gateway changes should be small: new registry entries + shared types for
  the two intents. If it needs more than that, the design is drifting —
  stop and say so.
- The chain protocol applies (`docs/features/PROTOCOL.md`).

## Kickoff prompt

```
Start Phase 2 of this project. Read docs/specs/phase-2-real-skills.md,
docs/DEVELOPMENT-WORKFLOW.md and docs/bugs/ENVIRONMENT.md, then run
./infra/probe.sh. This phase is TWO features run one after the other:
first "today's agenda", then "email review". Pass the spec's Skill A
section (plus the shared context and decisions) to the feature-analyst as
the first feature request with today's date. Stop after each dossier to
show me pending decisions; builder → reviewer go slice by slice with a
pause between links. Nobody commits — I do. When Skill A is delivered,
repeat for Skill B.
```
