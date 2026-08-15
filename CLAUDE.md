# CLAUDE.md

- All code, documentation, commits and file names are in **English**. Reply to
  the user in whatever language they write (usually Spanish).
- **Phases 1–3 are executed by the forja agent chain, not by hand.** The whole
  procedure is the `/next-phase` command — when the user says anything like
  "toma la siguiente fase", "arranca la fase" or "continúa el proyecto", run
  `/next-phase` instead of implementing directly. Specs live in `docs/specs/`;
  decisions marked "already taken" there are settled.
- Map of the project: `docs/ROADMAP.md` (phases), `docs/ARCHITECTURE.md`,
  `docs/adr/` (decisions), `docs/DEVELOPMENT-WORKFLOW.md` (how work flows).
- Environment truth is `docs/bugs/ENVIRONMENT.md`; `./infra/probe.sh` answers
  it in one call. Agents never start or stop services.
- Agents never commit or push — the user does.
- This is a **public showcase repo**: no secrets, no personal data in tracked
  files, dependencies chosen deliberately.
- Shared machine: never touch Docker containers not named `xavi-assistant-*`.
