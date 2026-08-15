# Bug protocol

Four agents pass a bug from hand to hand. This document is the only thing they
share: where a bug lives, how it's prioritized, what states it can be in, and
what each one writes. If anything here changes, it changes for all four.

The agents: `bug-reporter` → `bug-detective` → `bug-hunter` → `bug-auditor`.

## Where a bug lives

- `docs/bugs/QUEUE.md` — the queue. One row per bug, ordered by priority and,
  within the same priority, by age. It's the index, not the content.
- `docs/bugs/BUG-NNN-<slug>.md` — the dossier. Everything known about the bug,
  in four sections filled in order. Nobody deletes what another wrote: you
  append below.

The `NNN` is sequential, three digits. To know which is next, list the
existing files and take the highest + 1 **right before writing** — several
sessions run on this same working tree and two agents may be claiming a number
at once. If the file already exists, move on to the next.

For the same reason: `QUEUE.md` gets re-read **right before** modifying it, is
never rewritten whole from a stale copy in memory, and you touch only your own
row.

## Priority: how blocking it is for whoever's using it

There is exactly one axis: **can the person finish what they came to do?** Not
technical severity, not how ugly it looks.

|        | Meaning                                                       | Rule of thumb                                                                                                                                |
| ------ | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0** | They can't. And there's no way around.                        | The site or the panel won't load, publishing is impossible, data gets lost or corrupted, the business stops receiving contacts. Handled now. |
| **P1** | They can't by the normal path, but there's an awkward detour. | A dead button with a twin on another screen; a form that fails and forces redoing everything.                                                |
| **P2** | They can finish, but with friction or confusion.              | Something looks wrong, a text misleads, something takes too long without quite breaking.                                                     |
| **P3** | Doesn't affect the task.                                      | Visual detail, minor inconsistency, debt only the code's author sees.                                                                        |

Two corrections to the result:

- **How many people it happens to** breaks ties within the same level, it
  doesn't change level. A P1 on iPhone (half the traffic) goes before a P1
  that only occurs with the rarest combination of filters.
- **A data bug moves up one level.** Losing or mis-saving something the person
  wrote weighs more than the annoyance of the moment, because the damage
  stays.

If the report isn't enough to pick between two levels, take the lower of the
two and note in the dossier what it would take to raise it. Inflated priority
is useless priority.

## States

```
reported ──▶ analyzed ──▶ fixed ──▶ closed
    │            │           ▲
    │            │           └── returned ◀── (the auditor won't sign off)
    │            └──▶ not-reproducible
    └──▶ discarded
```

| State              | Who sets it | What it means                                                                                  |
| ------------------ | ----------- | ---------------------------------------------------------------------------------------------- |
| `reported`         | reporter    | Described and prioritized. Nobody has confirmed it yet.                                        |
| `analyzed`         | detective   | Reproduced, root cause located, and a fix proposed. Ready for the hunter.                      |
| `not-reproducible` | detective   | Couldn't be reproduced. What was tried is written down, so the user can supply what's missing. |
| `fixed`            | hunter      | The change is in the working tree, verified by whoever made it. **Uncommitted.**               |
| `returned`         | auditor     | The fix didn't pass the audit. Goes back to the hunter with the reason.                        |
| `closed`           | auditor     | Fix confirmed by a path different from the detective's.                                        |
| `discarded`        | user        | Not a bug, or the decision is not to fix it. The why gets written down.                        |

The hunter **does not commit**: the change stays in the working tree so the
auditor can test it exactly as-is, and the commit is the user's call after
closing.

## Turn budget

An agent pays its whole context on every turn. The spend isn't in what it
thinks, it's in how many times it stops to look for something. And what gets
out of hand isn't the agent that doesn't know: it's the one that **insists**.

| Agent         | Turns | When you hit the cap                                                                              |
| ------------- | ----- | ------------------------------------------------------------------------------------------------- |
| bug-reporter  | ~10   | Register with what you have, list the gaps as concrete questions, deliver.                        |
| bug-detective | ~35   | Write what you established, mark the rest as open questions, deliver an honest partial analysis.  |
| bug-hunter    | ~45   | Stop, leave the tree coherent (nothing half-written that doesn't compile), report what's missing. |
| bug-auditor   | ~30   | Report what you audited and what you didn't. **Never close a bug you didn't finish looking at.**  |

These aren't hard limits and nobody's counting them: they're the sign that
something that should be written down isn't. **An agent that stops and asks
costs a fraction of one that pushes on with confidence** — and it leaves the
hole in `ENVIRONMENT.md` visible, which otherwise gets paid for in silence
every single time.

## Dossier template

```markdown
---
id: BUG-000
title: <one line, in user language, not code language>
status: reported
priority: P2
area: <area> # whatever this project uses; ENVIRONMENT.md lists them
reported: YYYY-MM-DD
updated: YYYY-MM-DD
github_issue: 12 # only if it came from a GitHub issue — see below
---

# BUG-000 — <title>

## 1. Report — bug-reporter

**Summary for the detective:** (2 lines: what fails and where. It's all that
anyone not working on this section reads.)

**What happens:**
**Where:** (URL, screen, component if known)
**How to get there:** (numbered steps)
**What should happen:**
**Environment:** (device, browser, if it applies; "not stated" is an answer)
**Who it happens to:** (everyone / mobile only / admin only / …)
**Impact:** (what the person can't do — this is what justifies the priority)
**Priority: PN** because …
**User's words:** (verbatim quote; don't reinterpret it)
**Origin:** (who told it and through what channel; if it was an issue, its URL
and the paths of the screenshots downloaded to `docs/bugs/attachments/`)

## 2. Confirmation & analysis — bug-detective

**Summary for the hunter:** (3 lines: what fails, the root cause with
`file:line`, and what has to change.)
**Verification path I used:** (one line — the auditor needs to know which one
**not** to repeat, and it's all they'll read of this section.)

**Did it reproduce?**
**How, exactly:** (steps and literal evidence: outputs, measurements, logs)
**Root cause:** (`file:line` and why that produces this)
**Scope:** (what else the same defect touches)
**Where it does NOT go:** (what was ruled out, so nobody repeats it)
**Proposed fix:** (without applying it)
**How to prove it's done:** (verifiable criterion, not "check it looks right")

## 3. Fix — bug-hunter

**Summary for the auditor:** (3 lines: what changed, where, and what you'd
have to knock down to prove it doesn't work.)

**What changed:** (paths and what was done in each)
**Why this way:** (and what alternative was ruled out)
**Verification:** (commands and literal outputs)
**Risks:** (what this could have broken)
**Tree state:** (uncommitted / commit `hash` if the user asked for it)

## 4. Audit — bug-auditor

**Reproduction by another path:** (which one, and why it differs from the
detective's)
**Did it appear before the fix?** (how that was checked)
**Does it still appear?**
**Regressions checked:**
**Verdict:** closed | returned — because …
**For the user:** (what was happening and how it was fixed, in two paragraphs)
```

### Bugs that come from a GitHub issue

The repo's issues with the `bug` label enter the queue via `/bugs-github`
(the plugin's `bugs-github` skill), which hands them out to the
`bug-reporter`.

The `github_issue:` front-matter field is not decoration: it's the only link
that survives across sessions, and it's what the probe checks to avoid
re-registering an issue that already has a dossier. Without it, duplicates
get created. If the bug didn't come from GitHub, the field stays out.

**The trip back happens in two beats, and keeping them apart is deliberate:**

1. **The `bug-auditor` comments** on the issue when it closes the bug — what
   was happening, how it was fixed and what was left unverified — in the
   reporter's language, no file paths. It doesn't comment if it returned the
   bug. It ends with the marker `<!-- bug-auditor: BUG-NNN -->`, which is
   what prevents a double comment on a second audit.
2. **`issues-close.sh` (next to that skill) closes**, after the push. Dry-run
   by default; with `--close` it does it for real.

Between the two there's a gap of real time: when the auditor finishes, the
fix is **not committed** —its protocol forbids it— and a long while can pass
before it gets pushed. Closing the issue right then would announce "resolved"
with the code living on a single machine.

That's why the script doesn't decide from the working tree, but from the
dossier **as it is on `origin/main`**: if it says `status: closed` there, the
commit that left it that way is published, and since the fix and the dossier
travel in the same commit, so is the code. A dossier closed only locally
shows up listed as "waiting for push" and doesn't get touched.

An audit leaving loose ends (a real phone, a panel behind a session) **does
not block closing**: it closes as `completed` and the loose ends go stated in
the comment. Closed means "tested in everything that can be tested here, and
the rest is written down", same as in the dossier. If the reporter replies
with something that knocks it down, it gets reopened — which is cheap, and is
the reason this can be automatic.

## How not to overspend

An agent pays **its whole context on every turn**: each tool call re-reads
the entire conversation. So the expensive part isn't what it thinks, it's how
many times it stops to ask for something and how much it drags along.
Measured on this chain's first run, this is what would cut the cost in half
without dropping a single check:

- **A probe that measures six things costs the same as one that measures
  one.** Batch. The five thresholds of a grid, the ten links, the before and
  the after: one script returning one object with everything, not five
  calls. Before launching a measurement, ask yourself what else you'll want
  to know when you see the result, and measure it now.
- **Read only your part of the dossier.** Each section opens with a summary
  precisely for this. The detective reads section 1 in full. The hunter, the
  summary of 1 and all of 2. The auditor, the summaries of 1 and 2 plus the
  detective's "path I used", and all of 3. The rest is there if you need it —
  go get it when you need it, not just in case.
- **Read files by ranges** when you know which line you're after, and cap
  what you dump from the browser (`max_chars`). A full dump sits in your
  context until the task ends.
- **Don't redo work that's already written.** If the detective left the
  reproduction documented, the hunter doesn't rebuild it from scratch: check
  the after and the counter-test. The auditor's independent verification is
  deliberate, and that one stays.

And if you're missing a tool you need to do this right: **stop and say so in
your report**. You won't be able to ask for it mid-way, and an improvised
detour delivers a weak check without anyone noticing.

## How to verify

Applies to the detective, the hunter and the auditor.

**First thing, always: `docs/bugs/ENVIRONMENT.md`.** That file belongs to
this project and no other: addresses where it runs, what the user brings up,
how to get real data, what checks exist (types, linter, tests) and the
repository's own gotchas. `/cazabugs-init` creates it, and it gets corrected
when something changes. If it defines a probe, run it: it gives you all of
that in one turn.

If `ENVIRONMENT.md` doesn't exist, **stop and ask for `/cazabugs-init` to be
run**. Without it, an agent spends half an hour probing made-up addresses —
which is exactly the spend that file exists to cut.

**You don't bring services up or down.** The environment is the user's to
assemble. If something's down: say so, and go on with whatever doesn't depend
on it.

And these hold in any project:

- **The browser window may be hidden.** Then there are no screenshots, real
  clicks and keystrokes don't land, and CSS transitions don't advance. You
  measure the DOM; to read a transition's final state,
  `document.getAnimations().forEach(a => a.finish())` does it. Mistaking that
  for a failed fix is an expensive, easy mistake.
- **Scroll events don't fire without frames.** With the window hidden,
  `window.scrollTo(...)` moves the page but notifies nobody: pair it with
  `window.dispatchEvent(new Event('scroll'))`.
- **What only happens on a real device** (an actual phone, touch gestures,
  the camera) is not faked: you reason over the code, leave the test
  criterion written, and ask the user for the final confirmation.
- **What sits behind a login stays shut.** No entering credentials, ever.
  Whatever can only be seen in there is delivered as manual test steps.
- **Never `git stash`, `git checkout --` or anything that reverts the tree**
  to "see how it was before": other sessions may be working on the same
  files. To prove the fix is what changed things, recreate the old condition
  **live** (restore the attribute, property or value from the browser) and
  watch whether the bug comes back.
- **What gets served is not what got written.** Compilers and bundlers
  transform: they dedupe, reorder, minify. Check the real output, not the
  source.
- **Commands with explicit paths.** No `git add .`, no broad `pkill`.
