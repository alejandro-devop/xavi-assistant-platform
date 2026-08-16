---
id: FEAT-004
title: Per-skill dispatch timeout in the gateway (fix the agenda/email-review 502-before-the-LLM-answers collision)
status: delivered
architect: no # extends SkillDescriptor and makeSkillDispatcher, both already built in FEAT-001/FEAT-003 — see reason in section 1
area: gateway
requested: 2026-08-15
updated: 2026-08-15
---

# FEAT-004 — Per-skill dispatch timeout in the gateway

## 1. The request — feature-analyst

**Summary for whoever's next:** Add an optional `timeoutMs?: number` field to
`SkillDescriptor` (`packages/shared/src/index.ts`) so `makeSkillDispatcher`
(`apps/gateway/src/skills.ts`) can use a per-skill timeout instead of the
global 5s default, and set that field on the `agenda` and `email_review`
registry entries so their n8n round trips (which include an in-workflow
Ollama summarization call, measured 4.4–33.8s warm in FEAT-002) stop 502ing
before the workflow finishes. One slice: the field, the dispatcher line, the
two registry values, and tests for both the overridden and the default path.

**What problem it solves:** FEAT-002's builder measured the agenda skill's
warm summarization latency at 4.4s (empty day) to 33.8s (14 events) —
comfortably past the gateway's hard 5s dispatch timeout (`apps/gateway/src/skills.ts`,
`DEFAULT_SKILL_TIMEOUT_MS`). Once the agenda workflow is fully wired
(credential attached, activated), every summarized reply will abort at 5s
and answer 502 `skill_unavailable`, even though the workflow was working
correctly and would have answered seconds later. FEAT-003 (email review)
inherits the same collision and expects it to be _worse_, since summarizing
up to 25 emails with prioritization takes a longer prompt and likely longer
generation than a same-day calendar.

**Who it's for:** The project owner (Alejandro) — this is what makes the
agenda and email-review skills actually answer instead of always 502ing,
once their n8n credentials are attached.

**User's words:** This request comes from the user picking option (a) among
four the FEAT-002 builder wrote down when they hit the collision
(`docs/features/FEAT-002-todays-agenda-skill.md`, section 3, "What I
discovered that wasn't in the plan"):

> "(a) optional `timeoutMs` per `SkillDescriptor` (registry data + shared
> type + one dispatcher line, e.g. 45 s for agenda)"

The user settled this as **the** resolution (not just one option among
four) — recorded in FEAT-003's slice 1 builder entry: "the latency collision
inherited from FEAT-002 resolves via **option (a)** … as its **own
mini-feature**, run through the chain after this slice and before this
feature's slice 2." That decision is final for _this_ dossier: it is not
re-litigating (b)/(c)/(d).

**Decisions already taken (settled — do not re-ask):**

| Decision                            | Value                                                                                                                                                              | Why                                                                                                                              |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Which option resolves the collision | (a) — optional `timeoutMs` per `SkillDescriptor`, not a global bump, not a smaller model, not accept-502-and-retry                                                 | user decision, recorded in FEAT-003 slice 1                                                                                      |
| Where it lives                      | registry data (`SKILLS` in `apps/gateway/src/skills.ts`) + one new field on `SkillDescriptor` (`packages/shared/src/index.ts`) + one line in `makeSkillDispatcher` | this is the whole shape FEAT-002 sized the option at                                                                             |
| `ping`'s timeout                    | stays on the 5s default — no `timeoutMs` set for it                                                                                                                | ping is not LLM-backed, has no latency collision, FEAT-001's criterion for it should keep holding unchanged                      |
| No new gateway env var              | `timeoutMs` is registry data (per-skill, hardcoded by whoever adds a skill), not an env/`.env.example` setting                                                     | this is a per-skill constant, not a deployment knob — `.env.example`/docs stay untouched unless a criterion needs them (none do) |

**Constraints:**

- FEAT-001's other criteria for skill dispatch — the 502 shape
  (`{ok:false, intent, error:"skill_unavailable"}`), never-hang,
  never-crash — must keep holding for every skill, just at each skill's own
  budget instead of always 5s. This dossier **amends** FEAT-001's "within 5s"
  criterion for skills that opt into a longer `timeoutMs`; it does not touch
  it for skills that don't (`ping`). The amendment is user-authorized (this
  request).
- No new dependencies.
- Root checks (`pnpm lint && pnpm typecheck && pnpm format && pnpm test`)
  stay green.
- Builder never commits.
- `apps/gateway/.env.example` and docs stay untouched unless a criterion
  needs them — none does, since the timeout values are registry constants,
  not runtime configuration.

**Out of scope:**

- Options (b), (c), (d) from FEAT-002's section 3 — raising the global
  `DEFAULT_SKILL_TIMEOUT_MS`, a smaller/faster summarization model, or a
  502-then-retry UX. Settled against by the user's choice of (a).
- The intent-classification Ollama call's own timeout
  (`apps/gateway/src/intent.ts`, currently 30s, a separate budget from skill
  dispatch) — untouched; this dossier is only about the n8n webhook
  dispatch timeout.
- Actually completing the agenda/email-review round trip end to end — both
  still have user-gated steps ahead of them (n8n credentials, activation,
  the `OLLAMA_HOST` bind fix) documented in FEAT-002/FEAT-003. This feature
  removes the timeout collision; it does not perform those steps.
- Any change to the n8n workflows themselves (`agenda.json`,
  `email-review.json`) — the workflows already exist; only the gateway's
  patience for their answer changes.
- Making `timeoutMs` configurable via environment variable or exposing it
  as a per-request override — it's a fixed registry constant per skill,
  same granularity as `webhookPath`.
- Retrying a dispatch that timed out — a timeout still ends in one 502, as
  today, just after a longer wait for the skills that need it.

**Acceptance criteria:**

- [ ] `SkillDescriptor` (`packages/shared/src/index.ts`) gains an optional
      `readonly timeoutMs?: number` field, documented as "per-skill override
      of the dispatcher's default timeout; omit to use
      `DEFAULT_SKILL_TIMEOUT_MS`".
- [ ] `makeSkillDispatcher` (`apps/gateway/src/skills.ts`) uses the matched
      skill's `timeoutMs` when it's set (a positive number), otherwise falls
      back to the existing `options.timeoutMs ?? DEFAULT_SKILL_TIMEOUT_MS`
      behavior — unchanged for skills that don't set it.
- [ ] Unit test: a skill entry with `timeoutMs` set to some value below
      5000ms times out (aborts, `skill_unavailable`) at _that_ value, not at
      5000ms — proves the override is actually read, not just accepted by
      the type.
- [ ] Unit test: a skill entry _without_ `timeoutMs` still times out at the
      existing default (5000ms unless `options.timeoutMs` overrides it
      dispatcher-wide) — the no-override path is unchanged, regression-
      covered.
- [ ] The `agenda` entry in `SKILLS` sets `timeoutMs` to a value the
      dossier/builder justifies from FEAT-002's measured 4.4–33.8s warm
      latency plus headroom (proposed: 60s — see reasoning below; the
      builder may adjust with its own justification written down).
- [ ] The `email_review` entry in `SKILLS` sets `timeoutMs` to a value
      justified as higher than agenda's, per FEAT-003's expectation that
      summarizing up to 25 emails takes longer than a same-day calendar
      (proposed: 90s — see reasoning below).
- [ ] The `ping` entry keeps no `timeoutMs` — still bound by
      `DEFAULT_SKILL_TIMEOUT_MS` (5s), unchanged behavior, regression-tested.
- [ ] For every skill, on timeout the gateway still answers
      `502 {ok:false, intent, error:"skill_unavailable"}` with no hang and
      no crash — verified for at least one overridden-timeout skill, not
      just inherited from the pre-existing 5s-path tests.
- [ ] `pnpm lint && pnpm typecheck && pnpm format && pnpm test` stay green.
- [ ] No new dependency added (`package.json` diff limited to `apps/gateway`
      and `packages/shared` source files, no new entries in either
      `package.json`'s `dependencies`/`devDependencies`).
- [ ] `apps/gateway/.env.example` and any docs are unchanged, unless one of
      the criteria above turns out to need them (none currently does).

**Proposed timeout values, and why (not a blocking decision — see below):**

FEAT-002's builder measured agenda's warm Ollama summarization at 4.4s
(empty day) to 33.8s (14 events); its reviewer's own independent runs
measured 5.9–24.9s. Taking the highest observed number (33.8s) and roughly
doubling it for headroom (occasional slower runs, a cold Ollama load
stacking on top of generation — FEAT-001 measured a _separate_ cold-load
delay of 21.5s for the classifier's own Ollama call, which is evidence this
model's cold-start cost is non-trivial and could plausibly recur on the
workflow's own Ollama call too) gives **60s for agenda**.

Email review has no equivalent live measurement yet (its LLM leg isn't
built — that's this feature's blocker for FEAT-003's slice 2), but
FEAT-003's own dossier states it's expected to take _longer_ than agenda:
more items (up to 25 vs. an observed 14-event agenda), a longer prompt
(prioritization + grouping, not just chronological ordering). Scaling
agenda's 60s by roughly the same ratio the item counts imply (25/14 ≈ 1.8×,
rounded down for a not-strictly-linear cost) gives **90s for email
review**, with the same headroom reasoning as agenda already built in.

**These are proposed defaults derived from the measured data, not a
decision left for the user** — per this dossier's own scope guidance, the
values are justifiable from what FEAT-002 measured and headroom is a
technical judgment call, not a user preference (a builder finding these
numbers wrong once the email-review LLM leg is actually measured is free to
correct them with its own evidence, same category as FEAT-002's
empty-day-phrasing call).

**Slices:** (one — the change is small enough that splitting it further
would not produce a second independently useful slice)

| #   | What it does                                                                                                                                                                                                                                                                                                                                   | State    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | `timeoutMs?: number` added to `SkillDescriptor`; `makeSkillDispatcher` reads it per-matched-skill, falling back to the existing default when absent; `agenda` gets 60s, `email_review` gets 90s, `ping` unchanged; tests for the overridden path, the default-path regression, and a live-shaped 502-on-timeout check for an overridden skill. | accepted |

One slice, not the protocol's usual 3-4: the feature is a single field plus
a single conditional in one function plus two registry values — there is no
smaller "already useful" unit to peel off (a `timeoutMs` field that the
dispatcher doesn't read yet helps nobody; a dispatcher that reads it but no
registry entry sets it yet is unverifiable end to end), and there's no
larger scope hiding here either — this closes the exact gap FEAT-002/003
flagged, nothing more.

**Architect? no** because this hangs off two things that already exist and
were accepted, not a new concept:

- `SkillDescriptor` (`packages/shared/src/index.ts:34-44`) — a plain
  interface with `name`/`description`/`webhookPath`; adding one more
  optional field is the same shape of change FEAT-002 made when it added
  `AgendaSkillResult` and FEAT-003 made when it added
  `EmailReviewSkillResult`, just on a different existing type.
- `makeSkillDispatcher` (`apps/gateway/src/skills.ts:80-126`) — already
  accepts a dispatcher-wide `options.timeoutMs` (line 70) that overrides
  `DEFAULT_SKILL_TIMEOUT_MS`; already looks the matched skill up by name
  (`byName.get(intentName)`, line 93) before building the request. The
  change is reading `skill.timeoutMs` at the point the skill is already in
  hand and using it in place of `options.timeoutMs` for that one call — no
  new control flow, no new file, no new dependency between layers that
  don't already talk (gateway → n8n webhook, unchanged call shape).
- The registry (`SKILLS` array, same file) already holds per-entry data
  (`webhookPath`); `timeoutMs` is one more field on entries that already
  exist (`agenda`, `email_review`, `ping`) — no new entries created.

**Decisions that aren't mine:** none blocking. The one candidate — the
timeout _values_ — is resolved above with the measured-data-plus-headroom
reasoning the scope guidance asked for, not left open; flagged as a
builder-adjustable technical judgment call, not a business preference, in
the same category FEAT-002 used for its empty-day-phrasing call.

## 2. The plan — feature-architect

_(architect skipped — see "Architect? no" in section 1 for the reason and
the paths this hangs off. Chain goes analyst → builder → reviewer.)_

## 3. Construction — feature-builder

### Slice 1

**Summary for the reviewer:** `SkillDescriptor` gained `timeoutMs?`, the
dispatcher resolves it per matched skill (falling back to the old
dispatcher-wide default), and `agenda`/`email_review` carry 60s/90s in
`SKILLS`. What I most likely broke: I **rewrote two pre-existing tests**
("times out a hanging agenda/email-review webhook", `skills.test.ts`) — they
relied on the dispatcher-wide `timeoutMs: 20` reaching those skills, which
the new per-skill override now (correctly) preempts; a hanging-webhook test
against the real registry would take 60–90s, so they now prove the real
entries' budgets differently (via the timeout named in the failure log on an
instant network error), which is weaker evidence than an actual abort.

**What was built:**

- `packages/shared/src/index.ts` — `readonly timeoutMs?: number` on
  `SkillDescriptor`, documented as "per-skill override of the dispatcher's
  default timeout; omit to use `DEFAULT_SKILL_TIMEOUT_MS`" (+7 lines, the
  only change to this file in this slice).
- `apps/gateway/src/skills.ts` — `agenda` entry gets `timeoutMs: 60_000`,
  `email_review` gets `timeoutMs: 90_000` (each with its justification in a
  comment), `ping` untouched. In `makeSkillDispatcher`, the option-derived
  local is renamed `defaultTimeoutMs` and the per-call budget is resolved
  after the registry lookup: `skill.timeoutMs` when set and positive, else
  `defaultTimeoutMs`. Doc comments (module header, `DEFAULT_SKILL_TIMEOUT_MS`,
  `SkillDispatcherOptions.timeoutMs`) updated to describe the override.
- `apps/gateway/src/skills.test.ts` — 3 new registry tests (agenda 60s,
  email_review 90s, ping without `timeoutMs`); a hanging-webhook test where
  a skill with `timeoutMs: 20` aborts to the 502 outcome in <2s with the
  dispatcher default left at 5s (proves the override is read, not just
  typed); a non-positive `timeoutMs: 0` falls back to the dispatcher default;
  and the two rewritten agenda/email-review tests described above. The
  pre-existing ping hanging test (no override, dispatcher-wide 20ms) is
  untouched — that's the default-path regression.
- `docs/features/BOARD.md` + this dossier — state transitions, plus a
  Prettier table-alignment reflow of both files (`pnpm format` was red on my
  row edits until reformatted; content of other rows unchanged).

**Why this way:** The resolution lives inside the returned closure, after
`byName.get()`, because that's the one point the matched skill is in hand —
no new control flow, exactly the "one dispatcher line" FEAT-002 sized. The
`> 0` guard matches the criterion's "when it's set (a positive number)"
wording; alternative (trusting the type and skipping the guard) was ruled
out because a `timeoutMs: 0` would make `AbortSignal.timeout(0)` abort
instantly and silently kill a skill. For the real 60s/90s entries, asserting
the budget via the warn message on an instant `ECONNREFUSED` was chosen over
fake timers because `AbortSignal.timeout` doesn't sit on vitest's mockable
timers reliably, and over actually waiting because 150s of test wall-clock
is not a suite anyone runs.

**Verification:** (all from repo root, 2026-08-15)

- `pnpm lint` → green (`Tasks: 3 successful, 3 total`, uncached).
- `pnpm typecheck` → green.
- `pnpm format` → `All matched files use Prettier code style!`
- `npx turbo run test --force` (uncached) → `Test Files 3 passed (3)`,
  `Tests 87 passed (87)` (skills.test.ts: 39 tests).
- `pnpm build` → green.
- Live (n8n up on 5679, probe green): booted `dist/server.js` with a
  throwaway `GATEWAY_BEARER_TOKEN`, then
  `POST /command {"text":"ping"}` →
  `{"ok":true,"intent":"ping","reply":"pong","skillResult":{"ok":true,"reply":"pong",...}}`
  in 11.2s total (the intent classifier's own Ollama call; dispatch itself
  answered within the unchanged 5s budget). Killed the process; port 8787
  free, no strays. No data seeded (the ping workflow echoes, persists
  nothing).

**Criteria it closes:** (section 1, in order)

1. `timeoutMs?` field with the required doc wording — done
   (`packages/shared/src/index.ts`, `SkillDescriptor`).
2. Dispatcher uses it when positive, else old behavior — done
   (`skills.ts`, resolution line; `options.timeoutMs ?? DEFAULT_SKILL_TIMEOUT_MS`
   path untouched for skills without it).
3. Unit test, override below 5000ms aborts at that value — done
   ("times out a hanging webhook at the skill's own timeoutMs": 20ms
   override, dispatcher default 5s, resolves 502 in <2s, log names "20ms").
4. Unit test, no-override path unchanged — done (pre-existing ping hanging
   test at dispatcher-wide 20ms, kept verbatim; plus the `timeoutMs: 0`
   fallback test).
5. `agenda` at 60s with justification — done (dossier's own 2×-worst-case
   reasoning adopted; comment in `SKILLS`).
6. `email_review` at 90s, higher than agenda — done (comment in `SKILLS`).
7. `ping` without `timeoutMs`, regression-tested — done (registry test
   asserts the field is absent; hanging test proves 5s-default path).
8. 502 shape/no-hang/no-crash on timeout for an overridden skill — done at
   the dispatcher level (criterion 3's test resolves
   `{ok:false, error:"skill_unavailable"}`, never throws); the HTTP-level
   502 body shape is exercised by FEAT-001's untouched `app.test.ts`
   dispatch-failure tests, which still pass. A live 502 at the real 60s
   budget needs the agenda workflow active + credentialed — **pending manual
   testing** (user-gated per this dossier's out-of-scope).
9. Root checks green — done (outputs above, tests run uncached).
10. No new dependency — done: neither `package.json` touched
    (`git status`: only `packages/shared/package.json` shows modified, and
    that modification is FEAT-001's pre-existing uncommitted work, not
    mine).
11. `.env.example` and docs untouched — done (only the two protocol files,
    BOARD.md and this dossier, changed outside source).

**Risks:** The rewritten agenda/email-review timeout tests (see summary).
Also: any future caller relying on `SkillDispatcherOptions.timeoutMs`
applying to _every_ skill will now be preempted for skills that set their
own — that's the feature, but it's a behavior change of a public option.

**Blast radius (tree carries FEAT-001/002/003 uncommitted work):** my edits
are exactly the `timeoutMs` hunk in `packages/shared/src/index.ts`, the
hunks described above in `apps/gateway/src/skills.ts` and
`apps/gateway/src/skills.test.ts` (both inside the untracked `apps/gateway/`
from FEAT-001), and the two protocol markdown files. I did not touch
`app.ts`, `app.test.ts`, `intent.*`, `server.ts`, `config.ts`, any
`package.json`, `pnpm-lock.yaml`, workflows, or `.env.example`.

**Tree state:** uncommitted.

## 4. Review — feature-reviewer

### Slice 1

**Criteria, one by one:** (against section 1)

1. `timeoutMs?` on `SkillDescriptor` with the required doc wording — **met**
   (`packages/shared/src/index.ts`, read verbatim: "per-skill override of the
   dispatcher's default timeout; omit to use `DEFAULT_SKILL_TIMEOUT_MS`").
2. Dispatcher uses it when positive, else `options.timeoutMs ?? DEFAULT_SKILL_TIMEOUT_MS`
   — **met** (`skills.ts` resolution after `byName.get()`; the `> 0` guard
   matches the criterion's "a positive number" wording; default path textually
   unchanged).
3. Override-below-5000ms aborts at that value — **met** (20ms-override test
   with dispatcher default left at 5s, resolves in <2s) **and independently
   re-proven stronger** (see below: real socket, 104ms at a 100ms override).
4. No-override path unchanged — **met** (pre-existing ping hanging test kept
   verbatim; `timeoutMs: 0` fallback test; my probe measured the real default
   path aborting at 5001ms).
5. `agenda` at 60s with justification — **met** (registry value + comment
   citing FEAT-002's 4.4–33.8s and the 2× headroom; registry test).
6. `email_review` at 90s, higher than agenda — **met** (value + comment +
   test).
7. `ping` without `timeoutMs`, regression-tested — **met** (field-absence
   test; live ping round trip answered in 2.6s under the unchanged 5s budget).
8. 502 shape / no-hang / no-crash on timeout for an overridden skill — **met
   at dispatcher level**, strengthened by my probe (below). The HTTP-level 502
   at the real 60s budget stays **pending manual testing** — user-gated
   (agenda workflow credential + activation), as the builder recorded.
9. Root checks green — **met, re-run by me uncached**: `pnpm lint`,
   `pnpm typecheck`, `pnpm format`, `pnpm build` green;
   `npx turbo run test --force` → 87/87 (skills.test.ts 39).
10. No new dependency — **met**: `git status`/diff show no `dependencies` /
    `devDependencies` change anywhere; `packages/shared/package.json`'s diff
    is FEAT-001's exports/build wiring, not deps.
11. `.env.example`/docs untouched — **met** (only BOARD.md + this dossier
    outside source; other modified files are FEAT-001/002/003's pre-existing
    uncommitted work, per declared blast radius).

**The rewritten tests (builder's flagged risk):** the two rewritten
agenda/email-review tests assert the budget only via the number named in the
failure log on an instant `ECONNREFUSED` — genuinely weaker than an abort.
I closed the gap independently with a throwaway probe (scratchpad, not the
repo) against the **built** `dist/skills.js`, real `fetch`, real hanging TCP
socket:

- fake entry `timeoutMs: 100` → aborted at **104ms** with the clean
  `skill_unavailable` outcome (proves the per-skill abort fires, not just the
  log string);
- entry without `timeoutMs`, no dispatcher option → aborted at **5001ms**
  (real default budget binds);
- **real `SKILLS` registry**, dispatcher-wide `timeoutMs: 100`, `agenda`
  against the hanging socket → still pending at 1.5s (pre-FEAT-004 behavior
  would have aborted at 100ms), then resolved to a clean 502 when the socket
  was killed;
- `unhandledRejection` listener armed throughout: nothing fired.

Finding (not blocking): the log-string assertions couple those two tests to
the warn message format; a future rewording of the message would break them
without any behavior change.

**What broke nearby:** (how I looked) No graph in this repo
(`ENVIRONMENT.md`). Grepped `apps`/`packages` for `timeoutMs`,
`SkillDispatcherOptions`, `makeSkillDispatcher` outside the three touched
files: only `server.ts` (calls `makeSkillDispatcher` without `timeoutMs` —
unaffected by the default-vs-hard semantics change, which is documented in
the option's doc comment) and `intent.ts` (its `timeoutMs` is the separate
30s classifier budget, untouched, out of scope per section 1). FEAT-001's
`app.test.ts` (16 tests, HTTP-level 502 shape) passes untouched. Live boot
with a throwaway token, real n8n up (probe green): `healthz` 200, no-auth
401, bad-body 400 exact; `ping` → 200 `{ok, intent, reply:"pong",
skillResult}` in 2.6s (5s default intact); `agenda`/`email_review` (inactive
workflows → instant 404) → clean 502 `{ok:false, intent,
error:"skill_unavailable"}` in ~3s. Process killed, port 8787 free, no
strays. No regressions found in any of the above.

**States left unbuilt:** not a UI feature — empty/loading/long-text/mobile
don't apply. Error states _are_ the feature (timeout → 502, verified); no
permissions = 401, verified live. Nothing missing.

**Does it duplicate something that existed?** No architect ran, so checked
directly: nothing in the tree did per-skill dispatch budgets before this
(`intent.ts`'s timeout is a different budget for a different call; the
dispatcher-wide `options.timeoutMs` predates and is reused as the fallback,
not duplicated). Registry entries extended, none created.

**Verdict:** **accepted** — all eleven criteria met at the level checkable
today; the one remaining leg of criterion 8 (HTTP 502 at the real 60s budget
against a live activated workflow) is user-gated and listed below, same
pattern FEAT-002/FEAT-003 delivered with. Only slice → feature `delivered`.

**For the user:** Hasta ahora, aunque los workflows de agenda y de revisión
de correo estuvieran perfectamente configurados, el gateway les colgaba a los
5 segundos — y sus resúmenes con Ollama tardan entre 4 y 34 segundos (o más,
en frío). Eso significaba un 502 garantizado justo antes de que llegara la
respuesta. Ahora cada skill tiene su propio presupuesto de espera: la agenda
dispone de 60 segundos y la revisión de correo de 90, mientras que `ping` (y
cualquier skill futura que no pida más) sigue con los 5 segundos de siempre.
Un timeout sigue acabando en un único 502 limpio, sin cuelgues ni caídas.

Para probarlo a mano: con n8n arriba, arranca el gateway
(`GATEWAY_BEARER_TOKEN=... node apps/gateway/dist/server.js`) y lanza
`curl -X POST http://localhost:8787/command -H 'authorization: Bearer <token>'
-H 'content-type: application/json' -d '{"text":"ping"}'` — responde "pong"
como siempre. La prueba completa del nuevo presupuesto llegará cuando
adjuntes la credencial de Google Calendar al workflow de agenda, lo actives y
apliques el ajuste de `OLLAMA_HOST` (pasos pendientes documentados en
FEAT-002): entonces "qué tengo hoy?" debe responder el resumen aunque tarde
más de 5 segundos, y solo dar 502 pasado un minuto.
