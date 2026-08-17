---
id: BUG-001
title: Email review never gives the prioritized summary it promises — always falls back to the raw list
status: reported
priority: P1
area: infra
reported: 2026-08-16
updated: 2026-08-16
---

# BUG-001 — Email review never gives the prioritized summary it promises — always falls back to the raw list

## 1. Report — bug-reporter

**Summary for the detective:** `email-review` (and likely `agenda`) never
gets a successful reply from the "Summarize with Ollama" node inside n8n:
the gateway silently returns the deterministic fallback (`summarized:
false`, raw chronological list) while still answering `ok: true` / HTTP 200,
so the user cannot tell from the response that the LLM step failed.

**What happens:** Calling the gateway with intent `email_review` returns a
raw, chronological, bilingual-header list of messages instead of the
grouped/prioritized natural-language summary that FEAT-003 promises.
`summarized: false` is present in the response — per FEAT-003 that field is
the degradation path reserved for "the local model failed", not the normal
outcome.

**Where:** `apps/gateway` → `infra/n8n/workflows/email-review.json` (n8n
workflow, container `xavi-assistant-n8n-1`). Same suspected mechanism in
`infra/n8n/workflows/agenda.json`.

**How to get there:**

1. Gateway running (`docker compose` stack up, per `docs/bugs/ENVIRONMENT.md`).
2. Read the bearer token from `apps/gateway/.env` (do not print it to any
   file or terminal capture).
3. `curl -s --max-time 150 -X POST http://127.0.0.1:8787/command -H "Authorization: Bearer $GATEWAY_BEARER_TOKEN" -H 'content-type: application/json' -d '{"text":"revisa mi correo"}'`
4. Observe the response.

**What should happen:** A prioritized, grouped, natural-language summary
produced by the "Summarize with Ollama" node, with `summarized: true`, per
FEAT-003.

**Environment:** Local stack, `xavi-assistant-n8n-1` container. Not stated
whether this reproduces outside this machine/setup.

**Who it happens to:** Everyone using the `email-review` skill — this is the
first end-to-end run with real Google data, and it failed on the first try.
Suspected to also affect `agenda`, but that skill was only exercised on a
zero-event day, which does not touch the real summarization path (see gap
below).

**Impact:** The headline promise of the Phase 2 skills — an LLM-prioritized
summary — appears to have never actually run successfully. The user gets a
response that looks successful (`ok: true`, 200) but silently degrades to
raw data, so they cannot tell the feature is broken without inspecting the
payload themselves. The user can still read their email (the raw list is
usable), but only by doing the prioritization work themselves — which is
exactly what the assistant was supposed to do for them.

**Priority: P1** because the normal path (get a prioritized summary) is not
achievable at all — there is no evidence it has ever worked — but there is
an awkward detour: the user still receives the raw data and can read/sort it
manually. Not P0: no data is lost or corrupted, and the fallback response is
still functional. It would move to P0 if the silent-failure design were
found to also affect a path where the raw fallback is _not_ delivered (i.e.,
the user gets nothing usable), or if it turns out the `agenda` skill's
summarization is also broken on real (non-zero-event) data, doubling the
blast radius on both Phase 2 skills' core feature.

**User's words:** "The `email-review` n8n workflow returns its deterministic
fallback instead of the LLM-prioritized summary... there is NO evidence the
'Summarize with Ollama' node has ever succeeded inside a workflow run."

**Origin:** Reported directly by the user after the first end-to-end run of
the Phase 2 skills with real Google data, 2026-08-16/17. No screenshots or
URL; evidence is the `curl` reproduction above plus prior debugging notes
supplied with the report (see below).

**Evidence already gathered by the user (not re-derived here):**

1. Ollama IS reachable from inside the n8n container: a representative
   `/api/generate` call to `http://host.docker.internal:11434`, model
   `qwen2.5:7b`, `temperature 0`, `num_predict 500`, returned HTTP 200 in
   32.7s (`eval_count 118`). Measured from inside `xavi-assistant-n8n-1`
   using Node's `fetch` — the container has **no `curl` binary**, which is a
   debugging gotcha worth keeping in mind.
2. The word-cap guard is not the cause: `Finalize Reply` in
   `email-review.json` uses `WORD_CAP = 350` (generous); `agenda.json` uses
   `WORD_CAP = 130`.
3. `Finalize Reply` computes
   `summarized = text !== '' && words(text) <= WORD_CAP`. Since the cap
   isn't the constraint, the likely state is `text === ''` — i.e. the HTTP
   node produced no `response` field at all.
4. The "Summarize with Ollama" node has `onError: continueRegularOutput` and
   no retry, so any failure degrades silently — nothing appears in
   `docker logs xavi-assistant-n8n-1`. This is why the defect went unnoticed
   through review.
5. Node timeouts: `agenda` 30000ms, `email-review` 75000ms. Both post to
   `http://host.docker.internal:11434/api/generate` with body
   `={{ JSON.stringify($json.ollamaBody) }}`.

**Leading hypothesis from the user (not confirmed — for the detective to
weigh, not to assume):** the 75s timeout is exceeded on the real prompt. The
32.7s measurement above used a shortened, pre-grouped prompt; the real
prompt built by `Build Summary Prompt` is materially longer (numbered
requirements plus 23 individual message lines), so both prompt-eval and
generation would take longer. Secondary hypothesis: the HTTP Request node's
body/content-type handling of the `JSON.stringify($json.ollamaBody)`
expression may produce a request Ollama rejects. The user also suggests a
cheap decisive check: inspect the stored n8n execution for the failing run
to see what the node actually returned or errored with, rather than
inferring from the final reply.

**Gaps / open questions for the detective:**

- Does `agenda` also fail to summarize on a day with real events (non-zero),
  or does it only appear broken here because it was never exercised on real
  data? This determines whether the blast radius is confirmed-both-skills or
  suspected-one-confirmed-one.
- What does the n8n execution log for a failing `email-review` run actually
  show for the "Summarize with Ollama" node — timeout, HTTP error, malformed
  body, or something else? (Flagged by the user as the fastest way to
  confirm/deny the timeout hypothesis without re-guessing.)
- Does the failure reproduce consistently on every real (non-trivial) email
  review, or only past some message-count threshold?

## 2. Confirmation & analysis — bug-detective

## 3. Fix — bug-hunter

## 4. Audit — bug-auditor
