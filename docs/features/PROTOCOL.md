# Feature protocol

Four agents pass a feature from hand to hand. This document is the only thing
they share: where a feature lives, how it gets cut, what states it can be in
and what each one writes. If anything here changes, it changes for all four.

The agents: `feature-analyst` → `feature-architect` → `feature-builder` →
`feature-reviewer`.

**Two of the four don't always run.** The architect is skipped when the
feature hangs off something that already exists; the reviewer, never — but it
reviews per slice, not per feature. The exact rule is below.

## Where a feature lives

- `docs/features/BOARD.md` — the index. One row per feature, with its state
  and which slice it's on. Not the content.
- `docs/features/FEAT-NNN-<slug>.md` — the dossier. Four sections, filled in
  order. Nobody deletes what someone else wrote: you append below.

`NNN` is sequential, three digits. To know which is next, list the existing
files and take the highest + 1 **right before writing** — there can be several
sessions on the same working tree. If the file already exists, take the next
number.

Same reason: `BOARD.md` gets re-read **right before** editing it, never
rewritten whole from a stale copy in memory, and you touch only your own row.

## The question that cuts the work

In bugs the question is _can the person finish what they came to do?_, and it
keeps priorities from inflating. Here the question is different, and it keeps
the scope from inflating:

> **What is the smallest thing that's already useful to someone?**

That's the first slice. The rest are the next ones, or they're nothing.

A slice is **vertical**: it works end to end and someone can use it. "The data
model" is not a slice; "you can create an appointment and see it in the list,
without editing or canceling it" is. If a slice can't be tested on its own,
it's cut wrong.

Three or four slices per feature is healthy. If you get eight, the feature is
two features and that has to be said.

## Does the architect come in?

One question, not a size estimate:

> **Does this introduce a new concept, or hang off one that already exists?**

- **Hangs off** — one more field on a form that exists, a column on a table
  that exists, a filter on a listing that exists. The analyst notes where it
  hangs and the chain goes **analyst → builder → reviewer**.
- **Introduces** — a new entity, a screen with no sibling, something touching
  layers that don't talk to each other today. The architect comes in.

When in doubt, they come in. Erring toward the architect costs a few turns;
erring the other way costs building for the second time something that was
already there, and that isn't discovered until months later.

The `architect:` field in the front-matter takes `yes` or `no` **with its
reason in one line**. Without the reason it doesn't count: it's the decision
that costs the most when taken on inertia.

## States

```
requested ──▶ specified ──▶ planned ──▶ building ──▶ delivered
                │   │                      │    ▲
                │   └────(no architect)────┘    │
                │                           in-review
                │                               │
                │                           returned (the reviewer doesn't accept it)
                └──▶ blocked ──▶ discarded
```

| State       | Who sets it | What it means                                                                          |
| ----------- | ----------- | -------------------------------------------------------------------------------------- |
| `requested` | user        | It's been told; nobody has sorted it yet.                                              |
| `specified` | analyst     | Problem, scope, criteria and slices written. The user's decisions resolved or flagged. |
| `blocked`   | analyst     | A decision that isn't the agent's is missing. Nobody moves until it's answered.        |
| `planned`   | architect   | Slices with concrete paths and the reference implementation identified.                |
| `building`  | builder     | Working a slice.                                                                       |
| `in-review` | builder     | Slice finished and verified by whoever built it. **Uncommitted.**                      |
| `returned`  | reviewer    | The slice didn't pass. Back to the builder with the reason.                            |
| `delivered` | reviewer    | Every slice reviewed and accepted.                                                     |
| `discarded` | user        | Not happening. The why gets written down.                                              |

The front-matter state is the **feature's**. Each slice's state lives in the
table in section 2 (or section 1, if there was no architect). A feature in
`building` can have two slices accepted and one halfway: you read that in the
table, not in the front-matter.

The builder **does not commit**: it leaves the change in the working tree so
the reviewer can try it as-is, and the commit is the user's call.

## Turn budget

An agent pays its whole context on every turn. The spend isn't in what it
thinks, it's in how many times it stops to look something up. And what spirals
isn't the agent that doesn't know: it's the one that **insists**.

| Agent     | Turns         | At the cap                                                                                                |
| --------- | ------------- | --------------------------------------------------------------------------------------------------------- |
| analyst   | ~12           | Write what you have and set `blocked` with the questions.                                                 |
| architect | ~30           | Write the plan as far as you got and say what you didn't find.                                            |
| builder   | ~45 per slice | Stop, leave the tree in a coherent state and report what's missing.                                       |
| reviewer  | ~25           | Report what you reviewed and what went unreviewed. **Never accept a slice you didn't finish looking at.** |

These aren't hard limits and nobody is counting them: they're the signal that
something that should be written down isn't. **An agent that stops and asks
costs a fraction of one that keeps going with confidence** — and along the way
it leaves the hole in `ENVIRONMENT.md` visible, which otherwise gets paid in
silence every time.

If you're missing a tool to do this right, stop and say so in your report. You
won't be able to ask for it halfway through, and an improvised workaround
delivers a weak check without anyone noticing.

## Dossier template

```markdown
---
id: FEAT-000
title: <one line, in user language, not code language>
status: requested
architect: yes | no # with its reason in section 1
area: <area> # whatever this project uses; ENVIRONMENT.md lists them
requested: YYYY-MM-DD
updated: YYYY-MM-DD
---

# FEAT-000 — <title>

## 1. The request — feature-analyst

**Summary for whoever's next:** (2 lines: what's being built and what the
first slice is. It's the only thing read by anyone not working on this
section.)

**What problem it solves:** (the problem, not the solution)
**Who it's for:** (who will use it and when)
**User's words:** (verbatim quote; don't reinterpret it)

**Out of scope:** (what someone could assume is included and is NOT. This
list is worth more than the one inside.)

**Acceptance criteria:** (checkable. "Looks good" is not a criterion; "saving
without a title, the form doesn't submit and flags the field" is.)

- [ ] …

**Slices:** (vertical, each usable on its own)

| #   | What it does | State   |
| --- | ------------ | ------- |
| 1   | …            | pending |

**Architect? yes/no** because …
(if `no`: which existing thing it hangs off, with its path)

**Decisions that aren't mine:** (each with options and consequences, or
"resolved: <what the user said>")

## 2. The plan — feature-architect

**Summary for the builder:** (3 lines: what the reference implementation is,
where the new code goes, and what NOT to create because it already exists.)

**What already exists:** (whatever does this, or half of this, with
`file:line`. If nothing exists, say so explicitly — that's information.)
**Reference implementation:** (the module to imitate, and why that one)
**Where the new code goes:** (concrete paths, file by file)
**What NOT to create:** (what looks similar but is already solved)
**Where it does NOT go:** (what was ruled out, so nobody reconsiders it)

**Slices, with paths:**

| #   | What it does | Files | Criteria it closes | State   |
| --- | ------------ | ----- | ------------------ | ------- |
| 1   | …            | …     | …                  | pending |

## 3. Construction — feature-builder

_(one entry per slice, appended below)_

### Slice N

**Summary for the reviewer:** (3 lines: what was built, where, and what it
most likely broke.)

**What was built:** (paths and what was done in each one)
**Why this way:** (and which alternative was ruled out)
**Verification:** (commands and literal outputs)
**Criteria it closes:** (which ones from section 1, one by one, with evidence)
**Risks:** (what this could have broken)
**Tree state:** (uncommitted)

## 4. Review — feature-reviewer

_(one entry per slice)_

### Slice N

**Criteria, one by one:** (against section 1, not against the builder's
summary)
**What broke nearby:** (how you looked, not just the result)
**States left unbuilt:** (empty, loading, error, no permissions, long text,
mobile — which apply and which are missing)
**Does it duplicate something that existed?** (against section 2)
**Verdict:** accepted | returned — because …
**For the user:** (what can be done now that couldn't before, in two
paragraphs, and the steps to try it by hand)
```

## How not to overspend

An agent pays **its whole context on every turn**: every tool call re-reads
the entire conversation.

- **Read only your part of the dossier.** Each section opens with a summary
  precisely for this. The architect reads section 1 whole. The builder, the
  summary of 1, the criteria, and section 2 whole. The reviewer, the criteria
  from 1 — whole and literal, those don't get summarized — plus the section 3
  entry for its slice. The rest is there if needed: you go get it when you
  need it, not just in case.
- **The architect delivers paths, not prose.** A plan that says "follow the
  pattern of the other sections" forces the builder to repeat the whole
  exploration and throws away what the previous step cost. A plan that says
  "copy these three files" has it started by turn two. That's the difference
  between the architect saving and the architect being overhead.
- **If the project has a graph (`graphify-out/`), relational questions get
  queried, not searched.** "What's around this?", "are these two things
  already connected?", "who else uses this?" are one call to `query` / `path`
  / `explain`, and by hand they're many rounds of grep reading whole files.
  Location questions — "where is such-and-such file?" — are still a grep: the
  graph adds nothing there. `ENVIRONMENT.md` says whether there's a graph.
- **A probe that measures six things costs the same as one that measures
  one.** Batch. Before launching a measurement, ask yourself what else you'll
  want to know when you see the result, and measure it now.
- **Read files by ranges** when you know which line you're after, and cap
  what you dump from the browser (`max_chars`). A full dump stays in your
  context until the end.
- **Don't redo work that's already written.** If the architect left the
  reference located, the builder doesn't look for it again. The independent
  review IS on purpose, and that one doesn't get touched.

## How to verify

Applies to the architect, the builder and the reviewer.

**First, always: this project's `ENVIRONMENT.md`.** Look for it at
`docs/features/ENVIRONMENT.md` and, if it's not there, at
`docs/bugs/ENVIRONMENT.md` — it's the same map and the bugs chain may have
left it there. **Whichever one you find, don't modify it**: it may be in use
by other agents.

That's where what can't be deduced by reading code lives: what addresses the
project runs on, what the user brings up, how to get real data, what checks
exist (types, linter, tests) and this repository's own gotchas. If it defines
a probe, run it: it gives you all of that in one turn.

If it exists in neither place, **stop and ask for `/forja-init` to be run**.
Without it, hours go into trying made-up addresses.

**You don't start or stop services.** The user mounts the environment. If
something is down: say so, and continue with what doesn't depend on it.

And these hold in any project:

- **The browser window may be hidden.** Then there are no screenshots, real
  clicks and keystrokes don't land, and CSS transitions don't advance. You
  measure the DOM; to read a transition's final state,
  `document.getAnimations().forEach(a => a.finish())` does it.
- **Scroll events don't fire without frames.** With the window hidden,
  `window.scrollTo(...)` moves the page but notifies nobody: pair it with
  `window.dispatchEvent(new Event('scroll'))`.
- **What only happens on a real device** doesn't get faked: you reason over
  the code, leave the test criterion written down, and ask the user for the
  final confirmation.
- **What's behind a login stays closed.** No entering credentials, ever.
  Whatever can only be seen in there is delivered as manual test steps.
- **Never `git stash`, `git checkout --` or anything that reverts the tree.**
  Other sessions may be working on the same files.
- **What gets served is not what was written.** Compilers and bundlers
  transform. Check the real output, not the source.
- **Commands with explicit paths.** No `git add .`, no broad `pkill`.
