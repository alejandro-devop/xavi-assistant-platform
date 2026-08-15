---
description: Kick off (or resume) the next project phase with the forja agent chain
---

Kick off the next phase of this project with the forja chain.

1. **Which phase?** If an argument was given ("$ARGUMENTS"), that phase.
   Otherwise read `docs/ROADMAP.md` and `docs/features/BOARD.md`: the next
   phase is the first of 1, 2, 3 whose Definition of done doesn't hold yet
   (its features are not Delivered on the board). If 1–3 are all delivered,
   Phase 4 has no runnable spec — say it needs grooming first
   (`docs/specs/phase-4-evolution.md`) and stop.
2. **Load the ground.** Read the spec at `docs/specs/phase-<N>-*.md`,
   `docs/DEVELOPMENT-WORKFLOW.md` and `docs/bugs/ENVIRONMENT.md`, and run
   `./infra/probe.sh`.
3. **Preconditions.** If the spec declares a hard precondition (Phase 3 does)
   and it doesn't hold, stop and tell the user exactly what's missing.
4. **Resume, don't restart.** If `docs/features/BOARD.md` already shows this
   phase's feature in progress, pick the chain up from the state on disk
   (the dossier says which link is next) instead of creating a new dossier.
5. **Release the analyst.** Pass the spec — Goal, Context, Decisions already
   taken, Behavior required, Out of scope, User-gated steps — to the
   `feature-analyst` subagent as the feature request, including today's date
   in its prompt. Decisions marked "already taken" are settled: never
   re-asked, never changed.
6. **Pause at the joints.** After the dossier: show the user the decisions
   left for them, if any, and wait. On their go: `feature-architect` if the
   dossier says yes; then `feature-builder` → `feature-reviewer` one slice at
   a time, reporting between links.
7. **Nobody commits** — the user does. Phase 2 is two features: deliver the
   first completely before starting the second.
