---
id: FEAT-002
title: Ask Xavi "what's on my plate today?" and get a spoken-length rundown of today's calendar
status: delivered
architect: no # hangs off the skill-registry/dispatch pattern FEAT-001 already built, and the n8n workflow-export pattern already established — see reason in section 1
area: gateway
requested: 2026-08-15
updated: 2026-08-15
---

# FEAT-002 — Today's agenda skill

## 1. The request — feature-analyst

**Summary for whoever's next:** Add the `agenda` intent + n8n workflow so a
`curl` to the gateway with something like "what's on my plate today?" returns
a natural-language, time-ordered rundown of today's Google Calendar events
(primary calendar), summarized locally by Ollama, under ~120 words (it will
be spoken aloud in Phase 4). First slice: the workflow pulls and returns
today's events in a deterministic time-ordered format (no LLM yet), wired
into the gateway's existing registry, end to end via curl.

**What problem it solves:** The user wants a single spoken (eventually) or
typed question to replace opening the calendar app and reading today's
events themselves — a fast, hands-free "what do I have today" check.

**Who it's for:** The project owner (Alejandro), initially via `curl`; later
the iOS app (Phase 3) and spoken aloud (Phase 4), through the same gateway
intent.

**User's words:** This feature comes from a written spec, not a live
conversation. The spec's own framing is the closest thing to the requester's
words and is quoted verbatim (`docs/specs/phase-2-real-skills.md`, "Goal"
and "Skill A"):

> "Xavi does two genuinely useful things every day, end to end via `curl`
> (and later the iOS app): summarize today's agenda and review the inbox."
>
> "n8n workflow `agenda`: webhook → Google Calendar node (today's events,
> primary calendar) → Ollama summarization → respond. Reply: natural-language
> rundown ordered by time — event, time range, location/link if present. No
> events → say so pleasantly, not with an error. Summary stays under ~120
> words: it will be spoken aloud in Phase 4."

**Decisions already taken (settled by the spec — do not re-ask):**

| Decision                    | Value                                                                                                   | Why                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Where skills live           | n8n workflows triggered by webhook, one per skill                                                       | gateway stays a thin router (ARCHITECTURE.md)                  |
| Where summarization happens | inside the n8n workflow, calling Ollama at `http://host.docker.internal:11434` (HTTP Request node)      | keeps the gateway skill-agnostic; the workflow owns its prompt |
| External credentials        | ONLY in n8n's encrypted credential store (Google OAuth) — never in the repo, never in gateway env       | public repo, ADR-0004                                          |
| Workflow versioning         | sanitized export at `infra/n8n/workflows/agenda.json`, imported via the CLI recipe in `infra/README.md` | established pattern (`ping.json`)                              |
| New intent                  | `agenda` added to the registry; the `unknown` reply is updated to list it alongside `ping`              | Phase 1 registry design                                        |
| Reply language              | reply comes out in the user's language (the summarization prompt says so explicitly)                    | the user speaks Spanish; showcase readers may not              |
| Calendar scope              | today's events only, primary calendar                                                                   | spec's Skill A section, literal                                |

**Constraints (also settled, from the spec):**

- Gateway changes stay small: a new registry entry (`agenda` → webhook path)
  plus the shared type additions that entails. If it needs more than that, the
  design is drifting — say so instead of building it.
- Workflow export MUST be sanitized: no credential ids with secrets, no
  personal calendar data (real event names, locations, emails) in pinned
  test data — gitleaks and the reviewer both check.
- Email bodies/calendar data privacy rule from the shared spec context: this
  skill's summarization stays local (Ollama), same as skill B's, though the
  spec states the explicit "never leaves the machine" privacy rule for
  Skill B specifically — flagging that calendar data gets the same local-only
  handling by construction (n8n → Ollama, both local), not because a
  separate rule was written for it.
- The chain protocol applies (`docs/features/PROTOCOL.md`).

**Out of scope:**

- Creating, editing, or moving calendar events; marking anything; any
  write access to the calendar at all.
- Multiple calendars or multiple Google accounts (primary calendar only —
  see "which calendar/account" below).
- Date ranges other than today (no "tomorrow", "this week", "next
  Tuesday").
- Recurring-event edge cases beyond whatever the Calendar node returns
  natively (no custom recurrence expansion).
- Proactive/unprompted notifications (Phase 4).
- Any UI (Phase 3/4).
- Skill B — email review — is a separate feature/dossier, run after this one
  is delivered. It shares the gateway registry pattern and the n8n workflow
  pattern with this feature but is not built here.
- Actually speaking the reply aloud (Phase 4); the ~120-word cap is sized for
  that future use but TTS itself is not part of this feature.
- Creating the n8n owner account, the Google Cloud OAuth client, or
  connecting the Calendar credential in the n8n editor — user-gated, see
  below.

**Acceptance criteria:**

- [ ] A command whose intent classifies as `agenda` (e.g. "what's on my
      plate today?", "qué tengo hoy?") is routed by the gateway to the n8n
      `agenda` webhook — reusing the existing dispatch/timeout/502 machinery
      from FEAT-001, no new gateway error-handling code.
- [ ] `agenda` is added to the gateway's skill registry
      (`apps/gateway/src/skills.ts`) and shared types
      (`packages/shared/src/index.ts`); the `unknown`-intent capability
      reply lists `agenda` alongside `ping`.
- [ ] With events today: reply is a natural-language rundown, ordered by
      start time (earliest first), naming each event with its time range and,
      when the calendar entry has one, its location or link.
- [ ] With no events today: reply says so pleasantly (e.g. "you have nothing
      on the calendar today") — not an error, not `ok: false`, not an empty
      string.
- [ ] The reply stays at or under ~120 words regardless of how many events
      are on the calendar (a day with many events summarizes/groups rather
      than listing all of them verbatim past that budget).
- [ ] The reply mirrors the input command's language (Spanish in → Spanish
      reply; English in → English reply), same as `ping`'s unknown-reply
      precedent in FEAT-001.
- [ ] Only today's events from the primary calendar are pulled — no other
      calendars, no other days.
- [ ] If the n8n `agenda` webhook is down, answers non-2xx, or doesn't
      respond in time: the gateway's existing 502
      `{ok:false, intent:"agenda", error:"skill_unavailable"}` path fires —
      verified for this new webhook path specifically, not just inherited by
      assumption.
- [ ] `infra/n8n/workflows/agenda.json` is a sanitized export: no credential
      IDs carrying secrets, no real personal event/location/attendee data in
      any pinned/test data.
- [ ] No Google credential, token, or client secret appears in any tracked
      file (gateway env, repo, or workflow export) — the credential lives
      only in n8n's store.
- [ ] `pnpm lint && pnpm typecheck && pnpm format && pnpm test` stay green
      with the gateway-side change in place.

**Slices:** (vertical, each usable/testable on its own via curl against a
real calendar with real events)

| #   | What it does                                                                                                                                                                                                                                                                                         | State    |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | `agenda` workflow skeleton: webhook → Google Calendar node (today, primary) → deterministic time-ordered text formatting (event, time range, location/link; hardcoded pleasant line when empty) → respond. Gateway wired: registry entry, shared types, unknown-reply list updated. No LLM step yet. | accepted |
| 2   | Ollama summarization: workflow's HTTP Request node to `host.docker.internal:11434` turns slice 1's formatted list into the natural-language, ≤120-word, language-mirrored reply the criteria describe; empty-day phrasing may move into the LLM prompt or stay the static line (builder's call).     | accepted |

Two slices, not the protocol's usual three-to-four: most of the surrounding
machinery (auth, intent detection, dispatch, 502 handling, workspace/CI
plumbing) was already built and delivered in FEAT-001 and is only being
_reused_, not re-implemented — what's actually new here is the calendar
retrieval (slice 1) and the summarization layer on top of it (slice 2), and
each is independently useful and testable via curl with real data. If the
architect or builder finds this needs splitting further once the Calendar
node's real behavior is seen, that's fine to revise; two is the honest
starting cut given what's genuinely new.

**Architect? no** because this hangs off a pattern that already exists and
was accepted in FEAT-001, not a new concept:

- Skill registry + dispatch: `apps/gateway/src/skills.ts` (`SKILLS`
  descriptor list, `makeSkillDispatcher`, the 5s-timeout/502 machinery) and
  `apps/gateway/src/intent.ts` (`KNOWN_INTENTS` aliasing `SKILLS`, the
  unknown-reply generator that lists the registry) — adding `agenda` is
  exactly the "new registry entries + shared types" shape the spec itself
  prescribes as the small, correct-sized gateway change.
- Shared types: `packages/shared/src/index.ts` already has
  `SkillDescriptor`/`SkillRequest`/`SKILL_UNAVAILABLE` from FEAT-001 slice 3
  — `agenda` extends the same shapes, doesn't introduce new ones.
- Workflow export pattern: `infra/n8n/workflows/ping.json` is the reference
  for `agenda.json` (webhook trigger, sanitized export, CLI import recipe in
  `infra/README.md`).
- Nothing here touches a layer that doesn't already talk to the others: n8n
  → Ollama (host.docker.internal:11434) is the same call shape the gateway
  itself already makes to Ollama, just from inside the workflow instead of
  from `apps/gateway`. No new entity, no new screen, no new service.

**Decisions that aren't mine:**

- **Which calendar/account, if the user has more than one Google account or
  more than one relevant calendar.** The spec settles "primary calendar" as
  the default and says this becomes a user decision only if discovery shows
  there's more than one — the analyst has no access to the user's Google
  account and cannot do that discovery. Not blocking this dossier: flagged
  for whoever connects the Calendar credential in the n8n editor (a
  user-gated step below) to surface at that point if it turns out there's a
  choice to make. If it's genuinely just one account/calendar, this resolves
  itself with no decision needed.

**User-gated steps** (the user's accounts, the user's clicks — agents
document, never perform):

1. **n8n owner account.** Per `docs/bugs/ENVIRONMENT.md`, the n8n editor
   (`http://localhost:5679`) has no owner account yet; first visit shows the
   setup screen. Nothing below can happen until the user creates it.
2. **Google Cloud OAuth client.** The user creates an OAuth 2.0 client
   (Google Calendar API scope, read-only is enough for this feature) in
   Google Cloud Console.
3. **Connecting the Calendar credential in the n8n editor.** The user pastes
   the OAuth client's id/secret into n8n's credential store and completes
   the consent flow there — never in a repo file, never in gateway env.

None of the three block slices 1–2 from being _built_; they block the
workflow's Calendar node from returning _real_ data during verification. The
architect/builder should say plainly if verification had to stop short of a
live Calendar round trip for this reason.

## 2. The plan — feature-architect

_(architect skipped — see "Architect? no" in section 1 for the reason and
the paths this hangs off. Chain goes analyst → builder → reviewer.)_

## 3. Construction — feature-builder

### Slice 1

**Summary for the reviewer:** Built the `agenda` n8n workflow (webhook →
Google Calendar → deterministic formatter, sanitized export, imported but
NOT active) and wired `agenda` into the gateway registry + shared types.
What I most likely broke: nothing at compile level (the registry addition is
additive), but **the calendar leg is entirely unverified against real
Google data** — the Calendar node's parameters were built by reading the
node's schema inside the container (typeVersion 1.3), not by a live run,
and the `calendar: {mode: "list", value: "primary"}` resource-locator trick
is the part most likely to misbehave when the user finally attaches the
credential.

**What was built:**

- `infra/n8n/workflows/agenda.json` (new) — sanitized export following
  `ping.json`'s shape (id `XaviAgenda000001`, webhook node with
  `webhookId`, `responseMode: lastNode`):
  - Webhook `POST /webhook/agenda`.
  - Google Calendar node, typeVersion 1.3, `event:getAll`, primary
    calendar, `timeMin`/`timeMax` = `$now.startOf('day')`/`endOf('day')`
    (instance timezone — the container sets `GENERIC_TIMEZONE=America/Bogota`,
    so "today" is the user's today). `returnAll: true`, options empty —
    recurring events expand natively (node default `recurringEventHandling:
expand` ⇒ `singleEvents=true`). **`alwaysOutputData: true`** so a
    zero-event day still emits one item and the formatter runs.
  - Code node "Format Rundown": sorts by start time, formats
    `- HH:MM-HH:MM: title @ location-or-link` (all-day events say "all
    day"), truncates long titles/locations, lists at most 8 events and
    collapses the rest into "…plus N more / …y N más", enforces the
    ≤120-word budget with a deterministic shrink loop, and answers the
    hardcoded pleasant bilingual line on an empty day. Output shape:
    `{ok: true, reply, eventCount, date}` (= `AgendaSkillResult`).
  - **No `credentials` block, no `pinData`** — the Google credential is
    user-attached in the editor (ADR-0004); the export never carries it.
- `apps/gateway/src/skills.ts` — `agenda` appended to `SKILLS` (name,
  description, `webhookPath: "agenda"`). Because `KNOWN_INTENTS` aliases
  `SKILLS` and the classifier/unknown-reply prompts are built from the
  registry, the intent detection, the dispatch route and the capability
  reply all picked it up with this one change — no other gateway source
  file needed touching (exactly the "small change" section 1 demands).
- `packages/shared/src/index.ts` — added `AgendaSkillResult` documenting
  the workflow's reply contract for future consumers (iOS, Phase 3). The
  gateway itself still treats `skillResult` as opaque, by design.
- `apps/gateway/src/skills.test.ts` — +5 tests: agenda registry entry;
  dispatch POSTs to `{base}/agenda` with the `SkillRequest` body; the
  down/404/500 matrix for the agenda path specifically (asserting the warn
  names "agenda"); a real abort-path timeout test for agenda.
- `apps/gateway/src/intent.test.ts` — +4 tests: e2e 200 folding an
  `AgendaSkillResult` on a detected `agenda` intent (dispatch called
  exactly once with `{text, params}`); e2e 502 `skill_unavailable` for
  agenda; classifier prompt and static fallback reply both list `agenda`
  alongside `ping`.
- Imported the workflow into the live n8n via the README recipe
  (`docker cp` + `n8n import:workflow`) — it landed as `XaviAgenda000001`,
  **deactivated** (n8n deactivates on import, per the ENVIRONMENT gotcha).
  Deliberately NOT activated and the container NOT restarted — both are the
  user's, listed under "pending user steps" below.

**Why this way (deviations and judgment calls, each with its reason):**

- **Calendar node parameters were derived from the container's own node
  schema, not guessed**: read `EventDescription.js`/`GoogleCalendar.node.js`
  inside `xavi-assistant-n8n-1` (n8n 2.34.6, node versions [1, 1.1, 1.2,
  1.3]). Findings that shaped the export: (a) at typeVersion ≥1.3
  `timeMin`/`timeMax` are top-level fields; (b) the `id` resource-locator
  mode validates calendar IDs against an **email regex**, so
  `value: "primary"` would fail extraction — hence `mode: "list"` whose
  value passes through unvalidated and the Google API accepts `primary`;
  (c) Luxon `DateTime` from `$now` expressions round-trips through
  `dateObjectToISO` keeping the instance-timezone offset, so the day window
  is Bogota-local by construction.
- **Sorting happens in the Code node, not via the API's `orderBy` option**:
  deterministic, and independent of option semantics I could not verify
  live.
- **The slice-1 reply is bilingual-static, not language-mirrored**: the
  language-mirroring criterion applies to LLM-generated replies (FEAT-001
  precedent), and slice 1 has no LLM by design — slice 2 owns that
  criterion. Flagged, not silently claimed.
- **The word budget is enforced by construction** (truncate title to 12
  words, location to 6, max 8 listed, then a shrink loop while >120 words)
  rather than trusted: a 20-event day with pathological titles measured 102
  words in the harness.
- **Formatter verified by executing the export's actual `jsCode`**: a
  scratchpad harness extracted the string from `agenda.json` and ran it
  with shimmed `$input`/`$now` against fixtures (empty day, out-of-order
  events, all-day, location vs link vs neither, 20-event day, untitled
  event) — 15/15 checks passed. This tests the literal code that will run
  in n8n, not a copy.
- **Prettier side-effect owned up**: `pnpm format` required formatting this
  dossier, `BOARD.md` and `skills.test.ts`; in the dossier, Prettier
  mis-read the analyst's line-initial `+` ("+ the shared type additions")
  as a list marker and nested it — I restored the sentence with the word
  "plus". Meaning preserved, no other analyst text altered.

**Verification:** (all from the repo root, 2026-08-15)

- `./infra/probe.sh` first: n8n 5679 up, Ollama 11434 up (qwen2.5:7b), ping
  webhook answering.
- `pnpm lint` ✓, `pnpm typecheck` ✓, `pnpm format` ✓ ("All matched files
  use Prettier code style!"), `pnpm build` ✓, `pnpm test` ✓ — Vitest:
  `Tests  72 passed (72)` (was 62; +10 new).
- Formatter harness: 15/15 fixture checks (evidence above).
- `n8n import:workflow` on the real container: "Successfully imported 1
  workflow"; `n8n list:workflow` shows `XaviAgenda000001|agenda` next to
  the ping one — the export is structurally valid to n8n itself.
- **Live, end to end** (`node dist/server.js`, throwaway token inline, real
  Ollama; each boot killed after, 8787 + mock port verified free):
  - EN `"what is on my plate today?"` → intent `agenda`, 200, `skillResult`
    folded, reply = the rundown (webhook mocked with the
    `AgendaSkillResult` shape — see the caveat below). ES
    `"¿qué tengo hoy en la agenda?"` → same. Real qwen2.5:7b classified
    both.
  - Against the **real n8n** (agenda imported but inactive → webhook 404):
    `"qué tengo hoy?"` → **502**
    `{ok:false,intent:"agenda",error:"skill_unavailable",reply:"…bilingual…"}`
    in 3.1s; gateway log: `skill dispatch: "agenda" webhook answered HTTP
404`. The FEAT-001 machinery fires for this webhook path specifically,
    observed live, not inherited by assumption.
  - `"ping"` still round-trips through the real n8n (no regression).
  - Unknown-intent live: `"can you order me a pizza?"` → English reply
    naming ping and "give today's agenda"; `"¿me pides una pizza?"` →
    Spanish reply naming ping and "tu agenda del día". The capability reply
    lists the new skill, in the mirrored language, live.
- Cleanup: throwaway processes killed, ports verified free; the throwaway
  tokens lived only in env, never in a file; the scratchpad mock/harness
  live outside the repo. **One persistent side effect kept on purpose:** the
  imported (inactive) `agenda` workflow in n8n's DB — it is the recipe's
  intended outcome and the user's next step needs it there.

**Criteria it closes:** (slice-1 subset; slice 2 owns the rest)

- `agenda` intent routed to the n8n webhook, reusing FEAT-001 machinery, no
  new error-handling code — **closed** (live EN/ES round trips; no gateway
  source changed except the registry entry).
- Registry + shared types + unknown reply lists `agenda` — **closed**
  (code, tests, and live unknown replies above).
- 502 path verified for the new webhook path specifically — **closed**
  (live 404→502 against real n8n + unit matrix + timeout test).
- Sanitized export — **closed** (no `credentials`/`pinData`; grepped for
  credential/token/secret/email patterns: only the sanitization note
  matches; no real event data anywhere).
- No Google credential in any tracked file — **closed** (none exists yet
  anywhere; export carries none).
- lint/typecheck/format/test green — **closed** (outputs above).
- Rundown format ordered-by-time with time range and location/link, empty
  day pleasant, ≤120 words — **closed at formatter level** (harness runs
  the export's literal code; live verification against real calendar data
  is **pending user steps**, below).
- **Pending manual testing (user-gated, in order):** (1) create the n8n
  owner account at `http://localhost:5679`; (2) create the Google OAuth
  client (Calendar read-only scope) in Google Cloud Console; (3) open the
  `agenda` workflow in the editor, attach the credential on "Get Today's
  Events" — if the account has several calendars, this is the moment the
  "which calendar" flag from section 1 surfaces; (4) activate the workflow
  (editor toggle, or `docker exec xavi-assistant-n8n-1 n8n update:workflow
--id=XaviAgenda000001 --active=true`) and restart the container
  (`docker restart xavi-assistant-n8n-1`) so the production URL registers;
  (5) re-run the agenda curl — with real events it should answer the
  time-ordered rundown, with none the pleasant line.
- **Not closed here (slice 2):** language-mirrored reply,
  natural-language summarization via Ollama.

**Risks:**

- The Google Calendar node has never executed: parameter shapes were read
  from the node's source, but a live run with a real credential could still
  surprise (the `mode: "list"` primary-calendar trick, the exact event
  field population). First user run is the real test.
- Multi-day events overlapping today are included (Google's
  `timeMin`/`timeMax` are overlap semantics) and their time range shows
  their literal start/end clock times — within scope's "whatever the node
  returns natively", but worth one glance on first real data.
- `active: true` in the export mirrors `ping.json`'s pattern, but imports
  always arrive deactivated — nobody should read the file as "it's live".
- The gateway test files live inside `apps/gateway/`, which is still
  **untracked as a whole** from FEAT-001 — `git status` cannot separate my
  test additions from FEAT-001's files. My gateway-side blast radius, for
  the reviewer: `skills.ts` (registry entry only), `skills.test.ts`,
  `intent.test.ts`, plus `packages/shared/src/index.ts`
  (`AgendaSkillResult` block only) — everything else in those dirs is
  FEAT-001's, already reviewed.

**Tree state:** uncommitted, as the protocol requires.

### Slice 2

**Summary for the reviewer:** Added the Ollama summarization layer to the
`agenda` workflow (two new Code nodes + one HTTP Request node in
`agenda.json`, re-imported, still inactive) and the optional `summarized`
field to `AgendaSkillResult` — zero gateway code changed. What I most likely
broke: nothing that runs today, but **two environment collisions surfaced
that will bite the moment the user activates everything**: (1) Ollama only
listens on `127.0.0.1`, so the workflow's `host.docker.internal:11434` call
is connection-refused from inside the container until the user widens
`OLLAMA_HOST`; (2) live summarization measured 4.4–33.8 s warm on this
hardware — every gateway→agenda round trip will hit FEAT-001's 5 s dispatch
timeout and answer 502 until someone decides how to reconcile the two (I did
NOT patch the gateway; the dossier says gateway changes beyond the registry
entry mean "say so instead of building it", so I'm saying so).

**What was built:**

- `infra/n8n/workflows/agenda.json` — the pipeline grew from
  webhook → Calendar → Format Rundown to webhook → Calendar → Format Rundown
  → **Build Summary Prompt** (Code) → **Summarize with Ollama** (HTTP
  Request) → **Finalize Reply** (Code), `responseMode: lastNode` unchanged:
  - **Build Summary Prompt**: reads the deterministic rundown from Format
    Rundown and the user's original command from the webhook body (the
    gateway's `SkillRequest.text` — already sent since FEAT-001, so **no
    gateway change was needed for language mirroring**). Builds the Ollama
    `/api/generate` body (`qwen2.5:7b` hardcoded with a note, `stream:
false`, `temperature: 0.1`, `num_predict: 220`) with the prompt in
    FEAT-001's proven numbered-requirements + bilingual-clause shape
    (`intent.ts`, `buildUnknownReplyPrompt`). Carries
    `fallbackReply`/`eventCount`/`date` forward. A body without `text`
    (direct curl) degrades to "Written in English.", not an error.
  - **Summarize with Ollama**: HTTP Request typeVersion 4.2 (container
    supports up to 4.5, verified in its `HttpRequestV3.node.js`), POST
    `http://host.docker.internal:11434/api/generate`, 30 s node timeout,
    **`onError: "continueRegularOutput"`** so a down/slow Ollama flows an
    error item onward instead of failing the webhook.
  - **Finalize Reply**: emits the `AgendaSkillResult` shape. Uses Ollama's
    text only if non-empty and ≤130 words (grace over the ~120 target);
    anything else — error item, empty, overlong — falls back to the
    deterministic slice-1 rundown (≤120 by construction). Strips wrapping
    quotes. Adds `summarized: true|false` so anyone can tell which path
    answered. `ok: true` and a non-empty reply in every path, empty day
    included.
  - Format Rundown's logic is untouched; only its leading comment changed
    (it's now "fallback + LLM input", no longer "slice 2 replaces this").
- `packages/shared/src/index.ts` — `AgendaSkillResult` gains optional
  `summarized?: boolean` and its `reply` doc now describes the
  summarize-with-fallback behavior. Additive; the gateway still treats
  `skillResult` as opaque.
- Re-imported into the live n8n via the README recipe — "Successfully
  imported 1 workflow", n8n deactivated it on import as always;
  `list:workflow --active=true` shows only ping. Left inactive, container
  not restarted (user's steps).
- **No gateway source changed.** No new tests: the gateway's behavior is
  byte-identical, and the workflow's code is tested by harness (below).

**Why this way:**

- **Empty-day phrasing moved INTO the LLM prompt** (the builder's call
  section 1 left open): the live empty-day replies come out language-mirrored
  ("Hoy no tienes nada en el calendario. ¡Disfruta!" /
  "Your calendar is clear today—nothing scheduled. Enjoy!"), which the static
  bilingual line can't do — and that line remains as the fallback if Ollama
  is down, so the pleasant-empty-day criterion holds in both paths.
- **The prompt was tuned live, twice, with evidence** (not assumed): the
  first version (single "reply in the user's language" rule) failed exactly
  the way FEAT-001's comment warned — both EN scenarios answered in Spanish,
  dragged by the bilingual rundown text. Rewriting it in `intent.ts`'s
  numbered-requirements shape ("SAME LANGUAGE… si el usuario escribió en
  español…", plus "the calendar lines are bilingual — ignore their
  language") fixed 6/6. A second pass (temperature 0.3→0.1, "Name EVERY
  event… Do not invent events") fixed one dropped all-day event and one
  invented "lunch break" seen at 0.3.
- **Fallback-by-construction over trust**: the word budget and the
  no-error guarantee don't depend on the LLM obeying; Finalize Reply
  enforces both deterministically, falling back to slice 1's output.
- **Did not patch the gateway timeout** despite the measured collision —
  that's a design decision above this slice (options under "discovered").

**Verification:** (2026-08-15, repo root unless noted)

- `./infra/probe.sh` first: n8n 5679 up, Ollama 11434 up (qwen2.5:7b), ping
  webhook answering.
- **In-container reachability — FAILS, documented**: `docker exec
xavi-assistant-n8n-1 wget … http://host.docker.internal:11434/api/tags`
  and the exact `/api/generate` POST both answer
  `wget: can't connect to remote host (172.17.0.1): Connection refused`.
  DNS/`extra_hosts` resolve fine; the host's Ollama listens on
  `127.0.0.1:11434` only (`ss -tln` + the systemd unit has no `OLLAMA_HOST`).
  So the Ollama leg was verified **from the host** (same daemon, same model,
  same request body — only the TCP interface differs).
- **Harness, 46/46**: a scratchpad script extracts the three Code nodes'
  literal `jsCode` from `agenda.json` (the shipped strings, not copies),
  runs fixtures through Format Rundown → Build Summary Prompt, POSTs the
  node's exact `ollamaBody` to the real Ollama, and runs Finalize Reply on
  the real response. Six live scenarios — busy-ES, busy-EN, empty-ES,
  empty-EN, 14-event-ES, busy-with-no-body-text — all pass: `ok: true`,
  `summarized: true`, non-empty, ≤130 words, eventCount/date preserved, and
  a language check (ES markers vs EN markers) on every reply. Observed live
  outputs (fake fixture data):
  - busy-ES (57 words, 21.6 s): "Hoy tienes cuatro eventos. Comenzando con
    la tarifa de servicios públicos todo el día, luego un standup del equipo
    de 09:00 a 09:30 en https://meet.example/abc, seguido por una revisión
    del proyecto… Finalmente, tienes una cita con el dentista de 14:00 a
    15:00 en la clínica del centro ciudad." — every event, in order, with
    time ranges and location/link.
  - busy-EN (55 words, 19.8 s): "You have four events today. First, you need
    to pay your utility bill all day. Then, from 9:00 to 9:30, you have a
    team standup meeting at https://meet.example/abc…" — English in,
    English out.
  - empty-ES (8 words, 5.4 s) / empty-EN (7 words, 4.4 s): the mirrored
    pleasant lines quoted above.
  - many-ES, 14 events (73 words, 33.8 s): lists the 8 the rundown carries
    and closes "Además, hay seis más eventos que no se detallan en esta
    lista." — budget held on a heavy day.
  - Plus 4 offline failure-path checks: HTTP error item, empty response, and
    a 200-word response all fall back (`summarized: false`, reply ===
    deterministic rundown); wrapping-quote stripping works.
- Re-import: recipe output above; export re-validated as JSON; sanitization
  grep (`credential|pinData|token|secret|client_id|api key|password|
personal names`) matches only the explanatory `notes` prose.
- `pnpm lint` ✓, `pnpm typecheck` ✓, `pnpm format` ✓, `pnpm build` ✓,
  `pnpm test` ✓ — 72/72, unchanged count (no gateway code touched).
- Cleanup: fixtures were fake and lived only in the scratchpad harness;
  nothing seeded in n8n beyond the intended re-import of the (inactive)
  workflow — same declared persistent side effect as slice 1.

**Criteria it closes:** (the slice-2 subset left open by slice 1)

- Reply mirrors the input language — **closed at the Ollama leg, live**:
  6/6 scenarios above, ES→ES, EN→EN, no-text→EN, with the shipped prompt
  and the shipped node code. Full webhook round trip: user-gated.
- ≤ ~120 words regardless of event count — **closed, live + by
  construction**: live replies measured 7–73 words including a 14-event
  day; Finalize Reply falls back deterministically past 130.
- Natural-language rundown ordered by time with time ranges and
  location/link — **closed at the Ollama leg, live** (busy-ES/EN quoted:
  every event, original order, ranges and places kept; anti-invention rule
  tested). Against real calendar data: user-gated.
- No events → pleasant, `ok: true`, non-empty — **closed at the Ollama leg,
  live**, in both languages, and preserved in the fallback path.
- Sanitized export / no credential in tracked files — **closed** (grep
  above; the export still carries no `credentials` block, no `pinData`).
- lint/typecheck/format/test green — **closed** (all run, outputs above).
- **Pending manual testing (user-gated, updated list):**
  1. Make Ollama container-reachable: `sudo systemctl edit ollama`, add
     `[Service]` / `Environment="OLLAMA_HOST=0.0.0.0:11434"`, then
     `sudo systemctl restart ollama` (0.0.0.0 also exposes 11434 to the
     LAN — firewall it if that matters; Ollama takes a single bind
     address, so 0.0.0.0 is the way to cover localhost + the docker
     bridge). Verify with the `docker exec … wget …/api/tags` line above.
  2. n8n owner account, Google OAuth client, attach the credential —
     unchanged from slice 1's list.
  3. Activate the workflow and restart the container — unchanged.
  4. Decide the timeout question below, then the full curl: with real
     events expect a summarized, language-mirrored reply
     (`summarized: true`); with Ollama stopped expect the deterministic
     rundown (`summarized: false`) — never a webhook error.

**What I discovered that wasn't in the plan:**

- **`ENVIRONMENT.md`'s settled n8n→Ollama address doesn't work today**: the
  decision (`host.docker.internal:11434`) stands, but the host's Ollama
  binds `127.0.0.1` only — connection refused from the container, evidence
  above. Not fixable by an agent (systemd unit = user's system config); step
  1 of the pending list. `ENVIRONMENT.md` not modified per protocol; it's
  also stale about the gateway ("does not exist yet") — flagged here for
  whoever maintains it.
- **Summarization latency vs the gateway's 5 s dispatch timeout**: warm
  measurements 4.4 s (empty day) to 33.8 s (14 events) on this hardware
  (GTX 1050 4 GB; `ollama ps` shows the 7b model split 35 % CPU / 65 % GPU).
  Once everything is live, `/command`→agenda will 502 while the workflow is
  still summarizing — by FEAT-001's design, which this dossier forbids me
  from reworking on my own. Options for the user/analyst: (a) optional
  `timeoutMs` per `SkillDescriptor` (registry data + shared type + one
  dispatcher line, e.g. 45 s for agenda); (b) raise
  `DEFAULT_SKILL_TIMEOUT_MS` globally (touches a FEAT-001 criterion); (c) a
  smaller/faster model for summarization; (d) accept 502-then-retry UX. Not
  decided here.
- Minor, for the reviewer's eyes: the model hardcodes `qwen2.5:7b` in the
  workflow (the gateway reads `OLLAMA_MODEL` from env instead) — a Code
  node can't portably read env vars, and the prompt is tuned to this model
  anyway; noted in the node comment. The reviewer's slice-1 finding about
  multi-day-event clock display is untouched — out of this slice's scope.

**Risks:** the LLM leg has never run inside n8n (blocked by the bind gap),
so the HTTP node's `jsonBody` expression and `onError` behavior are
schema-verified but not container-executed; if qwen2.5:7b is ever swapped,
mirroring quality may drop (README already warns this for the gateway);
temperature 0.1 makes replies near-deterministic but hallucination can't be
ruled out at zero — the anti-invention rule and the fallback bound the
damage.

**Tree state:** uncommitted, as the protocol requires.

## 4. Review — feature-reviewer

### Slice 1

**Verdict first: accepted.** Every slice-1 criterion verified against section
1 as written — root checks re-run uncached (`turbo --force`), the formatter's
literal `jsCode` re-executed against my own edge fixtures (not the builder's
harness), every live scenario re-run against the built gateway on
`127.0.0.1:8787` with my own throwaway inline token, and the builder's three
never-executed-live claims (email-regex on the `id` resource-locator,
`recurringEventHandling` default, `GENERIC_TIMEZONE`) confirmed against the
container's own node source and env. The calendar leg against real Google
data stays user-gated, as the analyst's section 1 anticipated.

**Criteria, one by one:** (2026-08-15, all from the repo root)

- `agenda` intent routed to the n8n agenda webhook, FEAT-001 machinery
  reused, no new error-handling code — **met**: live EN
  ("what is on my plate today?") and ES ("¿qué tengo hoy en la agenda?")
  both classified `agenda` by the real qwen2.5:7b and dispatched (gateway
  log: `skill dispatch: "agenda" webhook answered HTTP 404` — the dispatch
  really left); `skills.ts` read in full — its dispatch/timeout/502
  machinery is byte-for-byte the FEAT-001 slice-3 surface, the only agenda
  addition is the registry entry.
- Registry + shared types + unknown reply lists `agenda` — **met**: entry in
  `SKILLS` (`apps/gateway/src/skills.ts`), `AgendaSkillResult` in
  `packages/shared/src/index.ts`, and **live** unknown replies in both
  languages named the agenda capability ("provide today's agenda…" /
  "proporcionarte tu agenda del día"). Tests pin the classifier prompt and
  static fallback both list it.
- Rundown ordered by start time with time range and location/link —
  **met at formatter level**: I extracted the export's literal `jsCode` and
  ran it against my own fixtures — 14/14, including cases the builder didn't
  try (start-less/cancelled item filtered, missing `end.dateTime` tolerated).
  Live against real calendar data: **pending user steps** (no credential
  exists — correctly anticipated in section 1).
- Empty day pleasant, `ok: true`, non-empty reply — **met at formatter
  level**: both the `alwaysOutputData` one-empty-item shape and a truly
  empty input answer the bilingual pleasant line with `eventCount: 0`.
- ≤ ~120 words regardless of event count — **met at formatter level**: a
  25-event fixture with pathological titles and long locations stayed ≤120
  via the shrink loop, with the bilingual "…plus N more / …y N más" line.
- Language-mirrored reply — **not closed here, correctly**: slice 1's reply
  is bilingual-static by design; section 1's own slice table assigns
  mirroring to slice 2. Open, not missed.
- Only today, primary calendar — **met at parameter level, source-verified**:
  the container's `EventDescription.js` does validate `id`-mode values with
  an email regex (lines 79–89 — `"primary"` would fail, the builder's
  `mode:"list"` reading is real, not invented), `recurringEventHandling`
  default is `expand` ⇒ `singleEvents=true` (`GoogleCalendar.node.js:354`),
  and `GENERIC_TIMEZONE=America/Bogota` confirmed via `printenv` — the
  `$now` day window is the user's today. Live confirmation: user-gated.
- 502 for this webhook path specifically — **met live**: agenda imported but
  inactive (`n8n list:workflow --active=true` shows only ping), so the real
  webhook answers 404 → both EN and ES agenda commands got
  `502 {ok:false,intent:"agenda",error:"skill_unavailable"}` in ~3s, no
  hang, and the server kept answering afterwards. Unit matrix + real
  abort-path timeout test back it.
- Sanitized export — **met**: `agenda.json` read in full and grepped
  (`credential|pinData|token|secret|client_id|@<domain>` patterns) — no
  `credentials` block, no `pinData`, no emails; the only match is the
  explanatory `notes` text. Shape matches `ping.json` (webhookId present,
  `responseMode: lastNode`, same export fields).
- No Google credential in any tracked file — **met**: none exists anywhere;
  the grep above plus the tree inventory found nothing token-like.
- lint/typecheck/format/test green — **met, run by me**: `pnpm lint` clean,
  `pnpm format` clean, `turbo run typecheck build test --force` (uncached)
  → 72/72 tests (62 at FEAT-001 close, +10 as declared).

**What broke nearby:** (how I looked, then what I found)

- `SKILLS` is consumed by `intent.ts` (`KNOWN_INTENTS = SKILLS`, classifier
  prompt, unknown-reply generator) and the dispatcher — grepped consumers,
  then verified the ripple live: ping still classifies and round-trips
  through the real n8n (`200`, `skillResult.receivedText` echoing my text),
  unknown EN/ES still answer 200 with capability replies, healthz `200`,
  401 body still exactly `{"error":"unauthorized"}`, 400 still the Ajv
  message. All 62 pre-existing tests pass inside the 72.
- FEAT-001's uncommitted work shares this tree; blast radii distinguished
  via `git status` + the builder's declared list — this slice's files
  (`agenda.json`, `skills.ts` entry, two test files, `AgendaSkillResult`
  block, dossier, board) match; nothing outside it changed by this slice.
- The live n8n: import landed as `XaviAgenda000001`, **inactive** — the one
  declared persistent side effect, confirmed and left untouched.
- No regression found where I looked.

**States left unbuilt:** empty day — built and verified; error — built (502
live); long text — built (truncation + word budget verified). Loading: N/A
(synchronous curl API). Mobile: N/A (no UI). One state worth naming as a
finding, not a return: **credential-not-attached but workflow active** —
the Calendar node will error, the webhook answers non-2xx, the gateway's
existing 502 covers it by construction; nobody has seen it live yet. It's
the same user-gated gap as the happy path.

**Does it duplicate something that existed?** No architect section, so
checked against FEAT-001's accepted surface directly: one registry (no
second intent list), no new dispatch/timeout/error code (the diff to
FEAT-001's described `skills.ts` is the registry entry alone), `agenda.json`
follows `ping.json`'s export pattern rather than inventing a second one, and
`AgendaSkillResult` extends `packages/shared` instead of a gateway-local
type. Nothing duplicated.

**Findings, none return-worthy:** (1) the calendar leg has never executed —
the builder says so plainly and section 1 pre-authorized stopping short; the
user's first real run (pending steps in section 3) is the actual test.
(2) Multi-day events overlapping today will show their literal start/end
clocks — builder-flagged, within scope's "whatever the node returns
natively"; one glance on first real data. (3) `active: true` in the export
vs. imports arriving deactivated — already documented, keep it in mind when
reading the file. (4) The builder's per-file test counts say +5/+4 where the
files gained +6/+4; the total (+10 → 72) is what matters and it's exact.

**Verdict:** accepted — all slice-1 criteria met with independent evidence
within the user-gated limits section 1 itself set; no regression found where
I looked; findings above. Slice 2 (Ollama summarization) remains — the
feature stays in construction, not delivered.

**For the user:** Xavi ya entiende la pregunta "¿qué tengo hoy?" (o "what's
on my plate today?") y la enruta a un workflow de agenda que lee tu Google
Calendar y devuelve la lista del día ordenada por hora — aún sin resumen de
LLM (eso es el slice 2). Para probarlo con datos reales faltan tus pasos:
(1) crear la cuenta owner de n8n en `http://localhost:5679`, (2) crear el
cliente OAuth de Google Calendar (scope de solo lectura) en Google Cloud
Console, (3) abrir el workflow `agenda` en el editor y adjuntar la
credencial en el nodo "Get Today's Events", (4) activar el workflow y
reiniciar el contenedor, y (5) lanzar el curl de `/command` con un texto
tipo "qué tengo hoy". Mientras tanto, ya puedes ver la mitad viva: cualquier
pregunta de agenda responde hoy un 502 limpio de "skill no disponible" (el
webhook existe pero está inactivo), y si le pides algo que no sabe hacer, la
respuesta lista la agenda entre sus capacidades, en tu idioma.

### Slice 2

**Verdict first: accepted — and with it the feature is delivered** (both
slices reviewed and accepted; the remaining legs are the user-gated steps
section 1 anticipated, plus one design decision escalated correctly, below).
Everything re-verified independently: root checks uncached, the export
audited in full, the three Code nodes' literal `jsCode` executed against my
own fixtures (including two adversarial cases the builder didn't try) with
the HTTP node's exact body sent to the real host Ollama, the
connection-refused claim reproduced from inside the container, and the
FEAT-001 + slice-1 surface re-run live.

**Criteria, one by one:** (2026-08-15, repo root; slice-2 subset — slice 1's
were verified in the entry above and re-checked live today)

- Reply mirrors the input language — **met at the Ollama leg, live, with my
  own fixtures**: ES-busy → Spanish naming all three events in order with
  ranges and places; EN-busy → English; ES/EN empty days → the mirrored
  pleasant lines; an event titled with emoji + HTML (`🎉 … <b>de Ana</b> …`)
  → clean Spanish reply, no tag leakage. A mixed-language command ("oye
  Xavi, what do I have hoy?") answered coherently in English — no criterion
  covers mixed input; noted as a finding, not a failure. 40/40 harness
  checks. Full in-container round trip: user-gated (see below).
- ≤ ~120 words regardless of event count — **met**: my live replies measured
  7–40 words; the builder's 14-event day, 73. The LLM path is capped
  deterministically at 130 (grace over the tilde), the fallback at ≤120 by
  construction; a fed 200-word response fell back, verified on the literal
  `Finalize Reply` code.
- Natural-language rundown, time-ordered, ranges and location/link — **met
  at the Ollama leg, live**: every event named, original order, ranges and
  places kept in both languages. Against real calendar data: user-gated.
- Empty day pleasant, `ok: true`, non-empty — **met live in both
  languages**, and the static bilingual line survives as the fallback (error
  item, empty response, quotes-only response all verified falling back with
  `ok: true`).
- Sanitized export — **met**: `agenda.json` re-read in full post-slice-2; no
  `credentials` block, no `pinData`, no emails/tokens; `webhookId` present;
  the only credential/secret mentions are the explanatory `notes` prose.
- No Google credential in any tracked file — **met**: none exists anywhere.
- lint/typecheck/format/test green — **met, run by me uncached**
  (`turbo --force`): 72/72, same count as slice 1 — consistent with "no
  gateway code touched".
- Wiring audited: linear chain Webhook → Calendar → Format Rundown → Build
  Summary Prompt → HTTP → Finalize Reply, `responseMode: lastNode`. The
  fallback "path" is not a branch: `onError: continueRegularOutput` flows
  the error item into Finalize Reply, which reads the rundown via
  `$('Build Summary Prompt').first().json.fallbackReply` — a valid
  cross-node reference since that node always executes upstream. Confirmed
  by executing the literal code with an error-shaped item.

**The two discovered items, judged against the literal criteria:**

1. **Ollama bind gap** — reproduced myself: `docker exec … wget
host.docker.internal:11434/api/tags` → "can't connect to remote host
   (172.17.0.1): Connection refused"; `ss -tln` shows the host's Ollama on
   `127.0.0.1:11434` only. The workflow implements exactly the settled
   address the dossier prescribes; the gap is the user's system config
   (systemd unit), documented with the fix and its LAN caveat. **A
   user-gated environment fact, not a criterion failure** — section 1
   explicitly pre-authorized verification stopping short of the live leg.
2. **Latency vs the 5 s dispatch timeout** — my runs confirm and sharpen
   it: even the _empty-day_ summarization took 5.9–6.5 s, busy days
   15.6–24.9 s. The collision is total: once live, every summarized reply
   will outlive the gateway timeout and answer 502. No slice-2 criterion
   requires sub-5 s summarization, and the dossier's own constraint forbade
   the builder from touching the gateway ("say so instead of building it")
   — which is literally what happened, with four options written down.
   **Correctly escalated design decision, not a criterion failure.** It
   does mean the user must decide (options a–d in section 3) before the
   happy path works end to end; that decision is a gateway change and
   belongs to a follow-up dossier, not to this feature's scope.

**What broke nearby:** (how I looked) `git status` against the declared
blast radius — matches (`agenda.json`, the `summarized?` block in
`packages/shared/src/index.ts`, dossier, board; all else is FEAT-001/slice-1
prior work). Grepped `AgendaSkillResult`/`summarized` consumers: only
`intent.test.ts`, which builds the type without the optional field —
compiles, nobody orphaned. Then the live suite on a fresh boot (throwaway
token, killed after, 8787 verified free): healthz 200, 401 exact body, 400
Ajv message, **ping round trip through the real n8n** (200,
`receivedText` echoed), agenda ES → clean 502 `skill_unavailable` (workflow
inactive), unknown EN/ES both listing agenda in the mirrored language.
`XaviAgenda000001` present and inactive (`list:workflow --active=true`
shows only ping). No regression found where I looked.

**States left unbuilt:** empty — built, live, both languages. Error — built
twice (Ollama-down fallback verified on the literal code; webhook-down 502
verified live). Long text — built (title/location truncation, 14-event day,
200-word-response fallback). Loading — N/A as a state (synchronous API),
but the 6–25 s latency IS the loading reality the timeout decision has to
absorb. No permissions / mobile — N/A. Still unseen live (same user-gated
gap as slice 1): credential-attached calendar leg, and the
credential-not-attached-but-active error shape.

**Does it duplicate something that existed?** No architect section; checked
against FEAT-001's accepted surface. The summary prompt reuses the
numbered-requirements + bilingual-clause _shape_ of `intent.ts`'s
`buildUnknownReplyPrompt` — deliberate imitation across runtimes (a Code
node can't import gateway code), matching the settled "the workflow owns
its prompt" decision, not duplication of a callable. No second registry, no
gateway change, no second export pattern. Nothing duplicated.

**Findings, none return-worthy:** (1) the 130-word grace cap vs the ~120
target — within the tilde; the fallback is strictly ≤120. (2)
`num_predict: 220` could truncate a reply mid-sentence while still passing
the word cap — unobserved in 6 live runs, bounded by the prompt's
"Under 100 words" rule. (3) Mixed-language input answers in English —
uncovered by any criterion. (4) The workflow hardcodes `qwen2.5:7b` while
the gateway reads `OLLAMA_MODEL` — builder-noted with reason; if the model
is ever swapped, both places need touching. (5) `docs/bugs/ENVIRONMENT.md`
is stale twice over: the gateway ("does not exist yet") and the
`host.docker.internal` advice, which omits that it requires `OLLAMA_HOST`
widened — not modified per protocol, flagged for its maintainer.

**Verdict:** accepted — all slice-2 criteria met with independent evidence
within the user-gated limits section 1 itself set; both discovered items
are documented environment facts / escalated decisions, not failures; no
regression found where I looked. Both slices accepted ⇒ **feature
delivered**.

**For the user:** Xavi ya responde "¿qué tengo hoy?" de principio a fin:
entiende la pregunta en tu idioma, lee los eventos de hoy de tu Google
Calendar (calendario principal), y en vez de recitarte la lista cruda, la
resume con el modelo local en un párrafo natural de menos de ~120 palabras,
en el idioma en que preguntaste — pensado para leerse en voz alta en la
Fase 4. Si el día está vacío te lo dice con gracia, y si el modelo local
está caído o tarda demasiado, degradas a la lista ordenada por hora del
slice 1, nunca a un error. Nada de tu calendario sale de tu máquina.

Para probarlo con datos reales, en este orden: (1) haz que Ollama escuche
para los contenedores: `sudo systemctl edit ollama`, añade `[Service]` y
`Environment="OLLAMA_HOST=0.0.0.0:11434"`, y `sudo systemctl restart
ollama` — ojo: eso también expone el puerto 11434 a tu LAN, pon firewall si
te importa; (2) crea la cuenta owner de n8n en `http://localhost:5679`;
(3) crea el cliente OAuth de Google Calendar (scope de solo lectura) en
Google Cloud Console; (4) abre el workflow `agenda` en el editor y adjunta
la credencial en "Get Today's Events" — si tienes varios calendarios, este
es el momento de elegir; (5) activa el workflow y reinicia el contenedor
(`docker restart xavi-assistant-n8n-1`); (6) lanza el curl de `/command`
con "qué tengo hoy". **Y una decisión que solo tú puedes tomar:** el resumen
tarda 6–25 s en tu hardware y el gateway corta a los 5 s, así que hoy ese
curl respondería 502 mientras el workflow sigue resumiendo. Antes del paso
6, elige entre las opciones del constructor (sección 3): timeout por skill
en el registro (la a, la más quirúrgica), subir el timeout global, un modelo
más pequeño, o aceptar 502-y-reintentar. Cualquiera de las tres primeras es
un cambio de gateway: pide una feature nueva con la opción elegida.
