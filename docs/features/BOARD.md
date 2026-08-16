# Feature board

One row per feature. It's the index, not the content: to know _what_ exists
you read here; to know _what's known_, the dossier (`FEAT-NNN-*.md`).

The user decides the order, not an agent. The state and slice rules are in
[PROTOCOL.md](PROTOCOL.md); this project's addresses and gotchas, in
`ENVIRONMENT.md` (here or in `docs/bugs/`).

| ID  | State | Slice | Area | Title | Requested |
| --- | ----- | ----- | ---- | ----- | --------- |

The **Slice** column says which one it's on: `2/4` is "the second of four". A
feature in `building` at `3/4` has two accepted and one in progress.

## Delivered

| ID       | Area    | Title                                                                                               | Delivered  |
| -------- | ------- | --------------------------------------------------------------------------------------------------- | ---------- |
| FEAT-001 | gateway | Send a text command and get back an intent-routed answer (gateway)                                  | 2026-08-15 |
| FEAT-002 | gateway | Ask Xavi "what's on my plate today?" and get a rundown of today's calendar (agenda skill)           | 2026-08-15 |
| FEAT-004 | gateway | Per-skill dispatch timeout in the gateway (fixes agenda/email-review's 502-before-answer collision) | 2026-08-15 |
| FEAT-003 | gateway | Ask Xavi "check my email" and get a prioritized summary of the unread inbox (email review skill)    | 2026-08-15 |
