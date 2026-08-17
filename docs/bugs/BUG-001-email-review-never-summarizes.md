---
id: BUG-001
title: Email review never gives the prioritized summary it promises — always falls back to the raw list
status: fixed
priority: P1
area: infra
reported: 2026-08-16
updated: 2026-08-17
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

**Summary for the hunter:** The "Summarize with Ollama" node aborts with
`timeout of 75000ms exceeded` because `qwen2.5:7b` genuinely needs 82–99 s to
write the answer the prompt asks for on this hardware (~3.7 tok/s: the 5.1 GB
model does not fit the GTX 1050's VRAM and runs 35 % on CPU). The timeout at
`infra/n8n/workflows/email-review.json:76` and the requested output size at
`:58` (`num_predict: 500`, "under about 200 words") are set independently and
are arithmetically incompatible. Same defect, worse, in
`infra/n8n/workflows/agenda.json:78` (30 s timeout vs. 31–48 s measured need).
Fix = shrink the requested output (measured: 25.8 s) and/or move to a model
that fits in VRAM; do **not** just raise the timeouts.

**Verification path I used:** stored n8n executions read out of the container's
SQLite (`execution_data`, `flatted`-encoded) + byte-exact replays of the stored
`ollamaBody` against Ollama from inside the container, then one end-to-end
`POST /command` through the gateway. The auditor should verify by a different
path — e.g. the n8n editor's Executions view and a cold-model gateway call.

**Did it reproduce?** Yes — and, importantly, **intermittently**. 2 of the 3
real `email-review` runs on record failed; the third passed. It is a marginal
timing bug, not an absolute one, which is exactly why it must not be declared
fixed on a single green run.

**How, exactly:**

_Step 1 — the stored executions (the decisive step the reporter flagged)._
Executions live in `/home/node/.n8n/database.sqlite` inside
`xavi-assistant-n8n-1`; the host has no `sqlite3` CLI and the container has no
`curl`, so both the DB reads and the HTTP probes were done with
`docker exec xavi-assistant-n8n-1 node -e '…'`, requiring n8n's own bundled
`sqlite3` and `flatted` out of
`/usr/local/lib/node_modules/n8n/node_modules/.pnpm/`. `execution_data.data`
is `flatted`-encoded, not plain JSON — `JSON.parse` on it fails.

Executions 47 and 48 (`XaviEmailRev0001`), per-node times:

```
Webhook                 1 ms
Get Unread Mail      6929 ms
Format Unread List     16 ms
Build Summary Prompt    8 ms
Summarize with Ollama 75008 ms   <-- exactly the configured 75000 ms
Finalize Reply         15 ms
```

The node's `executionStatus` is `success` (that is `onError:
continueRegularOutput` doing its job), and the item it emitted is:

```
{"error":{"message":"timeout of 75000ms exceeded","name":"AxiosError", … }}
```

No `response` field → `Finalize Reply` computes `text === ''` →
`summarized: false` → the deterministic list is returned. Both runs:
`messageCount: 23`, `capReached: false`, prompt 2691 chars.

_Step 2 — replay the byte-exact stored `ollamaBody` against Ollama._ Not a
reconstruction: the object taken verbatim out of execution 48's
`Build Summary Prompt` output, POSTed to
`http://host.docker.internal:11434/api/generate` from inside the container:

```
RUN1 http=200 wall=99.2s prompt_eval=697(10.8s) eval=302(82.1s) done=stop  words=150
RUN2 http=200 wall=82.2s prompt_eval=697( 0.2s) eval=302(81.6s) done=stop  words=150
```

HTTP 200 both times, a correct Spanish summary both times. Ollama is not
rejecting anything — it is simply slower than the node waits. 99.2 s cold,
82.2 s with the prompt cached; the node allows 75 s.

_Step 3 — the throughput, and why._ `ollama ps` reports
`qwen2.5:7b  5.1 GB  35%/65% CPU/GPU` on a GTX 1050. Generation measures
**3.61–3.93 tok/s** across every run. Prompt eval is 10.7 s cold, ~0.2 s
cached. So the node's 75 s buys at most ~(75 − 10.7) × 3.7 ≈ **235 generated
tokens**, while `num_predict` is set to 500 (≈ 135 s of generation) and the
prompt asks for "about 200 words" (≈ 280–300 tokens ≈ 80 s). The configured
answer size cannot fit the configured timeout. Whether a given run passes
depends only on how terse the model happens to be:

| run                  | generated tokens | node time | outcome            |
| -------------------- | ---------------- | --------- | ------------------ |
| exec 47 / 48         | 302              | 75.0 s ✗  | `summarized:false` |
| exec 50              | 173              | 58.7 s ✓  | `summarized:true`  |
| replay, as-is prompt | 302              | 84.4 s ✗  | would fail         |

_Step 4 — end-to-end through the gateway, per the report's steps._ Ran exactly
the report's `curl` (token read from `apps/gateway/.env`, never printed):
73.1 s wall, HTTP 200, **`summarized: true`**, a real prioritized Spanish
summary. It passed — because steps 2–3 had just left the model loaded and its
prompt cached. Stored as execution 50: Gmail 6447 ms, Ollama 58706 ms
(prompt_eval 703 in 10.74 s, eval 173 in 47.6 s), 16.3 s of headroom. Recording
this honestly: **my own probing changed the conditions that made it pass.** The
counter-test in step 3's last row (same prompt, cached prompt eval, 84.4 s)
shows the as-is configuration overruns whenever the model writes a
normal-length answer.

_Step 5 — the case that works (counter-test)._ Agenda execution 46, zero-event
day: Ollama node 9155 ms, `summarized: true`, reply
`"Hoy no tienes nada en el calendario. ¡Disfruta!"`. total 9.1 s =
prompt_eval 293 (5.3 s) + eval **16** tokens (3.4 s). The pipeline is
completely healthy; it only survives because a 16-token answer fits in 30 s.

**Threshold:** `email-review` fails whenever the model emits more than ~235
tokens (cold) / ~240 (warm-cached). On the observed 23-message inbox that is
roughly a coin flip. `agenda` fails from ~1–3 events upward (see Scope). It is
not a message-count threshold in the way the report's third open question
guessed — the message count only moves prompt length, which costs 10.7 s at
most; the cost is **output** length.

**Root cause:**

`infra/n8n/workflows/email-review.json:76` — `"timeout": 75000` on the
"Summarize with Ollama" node is below the time `qwen2.5:7b` needs on this host
to generate the answer requested at `infra/n8n/workflows/email-review.json:58`
(`num_predict: 500`, requirement 5 "stay under about 200 words"). At the
measured 3.7 tok/s those two numbers cannot both hold: axios aborts the
request, `onError: continueRegularOutput` turns the abort into a normal item
with no `response` field, and `Finalize Reply`
(`infra/n8n/workflows/email-review.json:87`) falls back to the deterministic
list with `summarized: false`.

Underneath it is a hardware constraint, and this is the part that decides the
fix: the 5.1 GB model does not fit the GTX 1050's VRAM, so 35 % of it runs on
4 CPU cores. `docs/bugs/ENVIRONMENT.md`'s "~6 s warm" and "32.7 s for a
representative summarizing prompt" are both far too optimistic for the real
workload (58–99 s) — corrected in that file as part of this analysis.

**Scope:**

- **`infra/n8n/workflows/agenda.json:78` has the same defect, worse.** Timeout
  30000 ms against `num_predict: 220` and "Under 100 words" (`:60`). I replayed
  agenda's own `Format Rundown` + `Build Summary Prompt` logic verbatim with
  synthetic events (script kept at
  `/tmp/claude-1001/…/scratchpad/agenda-sim.js`) and timed real Ollama calls:

  ```
  3 events: wall 31.5 s  prompt_eval 372(5.5s)  eval  96(25.5s)  ->  exceeds 30 s
  6 events: wall 47.6 s  prompt_eval 433(5.5s)  eval 160(41.7s)  ->  exceeds 30 s
  ```

  So agenda fails from the very first day that has events — it looked healthy
  only because it was exercised on a zero-event day. **This settles the
  reporter's first open question: yes, both Phase 2 skills are broken.**

- **`apps/gateway/src/skills.ts:35` and `:45`** (agenda 60 s, email_review
  90 s) are part of the same budget chain and must move with any timeout
  change. email_review's 90 s currently has only ~8 s over the 75 s node plus
  ~6.5 s of Gmail; that margin is what keeps the fallback reaching the user at
  all.

- The pattern is copied identically into both workflows: node timeout,
  `num_predict` and the prompt's word target are three independent literals
  with no relationship expressed anywhere. Whatever is fixed should be fixed in
  both, the same way.

**Where it does NOT go** (ruled out, with the evidence — do not re-walk these):

- **Not the malformed body / content-type hypothesis.** The
  `={{ JSON.stringify($json.ollamaBody) }}` expression works: agenda exec 46
  got HTTP 200 and a full Ollama JSON payload through an identically configured
  node, and the byte-exact stored `ollamaBody` returned 200 on replay.
- **Not Ollama being unreachable from the container.** Reachable; every probe
  returned 200. `./infra/probe.sh` agrees.
- **Not the `WORD_CAP` guard** in either `Finalize Reply`. Answers measured at
  44–150 words against a 350-word cap; the fallback fires on `text === ''`, not
  on the cap. (The reporter's inference #3 was correct.)
- **Not the Gmail node, the message parsing or the grouping.** 23 messages
  fetched in 6.4–6.9 s and formatted correctly; the pre-grouping produces exact
  counts, and the successful run's summary is good.
- **Not a gateway-side abort.** The gateway's 90 s was never reached in the
  failing runs — the workflow returned at ~82 s with the fallback.
- **Not `onError: continueRegularOutput` itself.** That is the deliberate
  degradation design (FEAT-002/003, stated in the node notes). What is wrong is
  that a failure leaves no trace anywhere — see the last fix item.
- **Not a prompt-length / message-count problem.** Prompt eval is ≤ 10.8 s even
  at 697 tokens. The cost is generation.

**Proposed fix** (not applied — the choice between A and B is the hunter's,
and B needs the user):

**A. Point patch — shrink the requested output to fit the existing budget.**
Measured, on the byte-exact real prompt with only requirement 5 changed to
"stay UNDER 80 WORDS. Group aggressively; do not list every sender." and
`num_predict: 150`:

```
as-is      (200w / num_predict 500): 84.4 s, 302 tokens  -> over budget
tightened  ( 80w / num_predict 150): 25.8 s,  92 tokens  -> 3x margin under 75 s
```

Apply the equivalent to `agenda.json` (`num_predict: 220 → 120`, requirement 4
to ~50 words) and raise its node timeout `30000 → 45000` (still inside the
gateway's 60 s). The hunter must re-measure agenda — I measured its prompt, not
a real Google Calendar round trip. Cost: shorter, less rich summaries. That is
what this hardware can deliver at an acceptable latency, and it is still a
prioritized summary rather than a raw list.

**B. Root change — run a model that fits in VRAM.** `qwen2.5:3b` (~2 GB) fits
the GTX 1050 entirely and should be several times faster, which would let both
prompts keep their intended richness. **Pulling a model is the user's call** — it
downloads ~2 GB and changes their Ollama store, so I did not do it. Both prompts
were tuned live on 7b (see the tuning notes in each Code node), so this implies
a re-tune, and `MODEL` is hard-coded in both workflows.

**C. What NOT to do: raise the timeouts alone** to fit the measured worst case
(node ~150 s, gateway ~170 s). Two reasons. A 2.5-minute answer is unusable for
the Phase 4 voice assistant. And the public `api.<domain>` path goes through
the Cloudflare Tunnel, whose edge cuts long responses (524) at ~100 s — I did
**not** measure this, it is a platform default the hunter should verify before
relying on any budget above ~90 s. Worse, if a raised node timeout ever exceeds
the gateway budget, the user stops getting even the fallback — that is the
scenario that would make this bug P0.

**D. Do this regardless of A or B: make the failure visible.** This is the half
of the bug that let it ship. `Finalize Reply` already knows the node failed
(it has the error item in `$input`); it should carry the reason into the result
(e.g. a `summaryError` field alongside `summarized: false`) and/or
`console.log` it so it lands in `docker logs xavi-assistant-n8n-1`. Today the
only way to learn what happened is the archaeology in this section.

**Priority: stays P1.** The reporter set a P0 trigger on "agenda is also broken
on real data", and I confirmed it. But PROTOCOL is explicit that blast radius
breaks ties _within_ a level rather than changing the level, and on both skills
the awkward detour still exists: the user receives the raw deterministic list
and can do the prioritizing themselves. So it sits at the top of P1. It becomes
P0 the moment a fix pushes a workflow past the gateway budget, because then the
user gets an error and nothing usable.

**How to prove it's done** (this bug is variance-driven — one green run proves
nothing):

1. With the model **cold** (after `ollama stop qwen2.5:7b`, the user's call, or
   a reboot), `POST /command {"text":"revisa mi correo"}` on an inbox with ≥ 20
   unread returns `summarized: true`.
2. Repeat immediately **three times in a row**; all three return
   `summarized: true`.
3. In the stored executions for those runs, "Summarize with Ollama"
   `executionTime` is **below 70 % of the node's configured timeout** in every
   one — that is the margin that stops this recurring on a slightly chattier
   day. Read it with the `docker exec … node -e` recipe above, or in the n8n
   editor's Executions view.
4. Agenda: on a day with ≥ 3 events, `summarized: true` and the same 70 % rule.
   This needs a real calendar event, which is **the user's call to create** — I
   did not create one. Failing that, re-run
   `scratchpad/agenda-sim.js` against the patched prompt and require wall time
   below 70 % of the agenda node's timeout.
5. `pnpm typecheck && pnpm lint && pnpm test` stay green if
   `apps/gateway/src/skills.ts` is touched.

**Open questions I could not close:**

- Agenda has never been exercised end-to-end through the real Google Calendar
  node with events. I measured its prompt against Ollama, not the full round
  trip; the Calendar fetch cost (426 ms on the empty day) is the only unknown,
  and it is small. Creating a calendar event is the user's decision.
- Whether the Cloudflare Tunnel really cuts at ~100 s on the public `api.`
  hostname. Relevant only if the hunter chooses to raise budgets (option C).
- Whether `qwen2.5:3b` is fast enough and good enough at this prompt to make
  option B worthwhile — untestable without pulling the model.

## 3. Fix — bug-hunter

**Summary for the auditor:** Both workflows now ask the model for an answer
that fits the time it is given — `email-review` for ~90 words at
`num_predict: 150` (42.9 s cold against a 75 s node timeout, was 100.2 s),
`agenda` for ~60 words at `num_predict: 140` with its node timeout raised
30 s → **50 s** (not the detective's 45 s — see "Why this way"). Every
fallback now names its reason in the result (`summaryError`) and on stdout.
To knock it down: run either skill on a **cold** model (that is where all the
margin goes), or find a case where a truncated answer reaches the user.

**⚠ The live n8n is still running the OLD workflow definitions.** The repo
JSON is fixed and measured; importing it was blocked by this session's
permission classifier, so nothing was verified end-to-end through the
gateway. The user must run the re-import below before the auditor can test
anything through `POST /command`.

### What changed

| Path                                    | Change                                                                                                                                                                                                                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `infra/n8n/workflows/email-review.json` | `Build Summary Prompt`: requirement 5 "under about 200 words" → "UNDER 90 WORDS … one short clause each, no commentary"; `num_predict` 500 → 150. Node timeout **unchanged at 75000**.                                                                                          |
| `infra/n8n/workflows/agenda.json`       | `Build Summary Prompt`: requirement 4 "Under 100 words" → "Under 60 words … one short clause per event"; `num_predict` 220 → 140. `Summarize with Ollama` timeout 30000 → **50000**.                                                                                            |
| `Finalize Reply` in **both**            | A failure now produces a reason: `summaryError` in the result and a `console.log` line that reaches `docker logs xavi-assistant-n8n-1`. New guard: `done_reason: 'length'` (the answer was cut by `num_predict`) counts as a failure instead of reaching the user mid-sentence. |
| `packages/shared/src/index.ts`          | `summaryError?: string` on `AgendaSkillResult` and `EmailReviewSkillResult`.                                                                                                                                                                                                    |
| `apps/gateway/src/skills.ts`            | Comments only — the budget-chain invariant (`node timeout < dispatch budget`) written next to the two numbers that must honour it. **No value changed**: 60 s / 90 s stand.                                                                                                     |

Every new literal carries a comment saying what it was measured against and
that raising the timeout is not the lever. That is deliberate: the three
numbers were independent literals with nothing linking them, which is how
they drifted apart in the first place.

### Why this way

**The word budgets keep the delivered acceptance criteria true.** The
detective's measured wording for `email-review` was "stay UNDER 80 WORDS.
Group aggressively; **do not list every sender**" — that contradicts
FEAT-003's criterion "each item names the sender and a short gist" and its
own requirement 4 ("Name EVERY individual message"). Not shipped. Instead
requirement 4 is left untouched and requirement 5 constrains the _density_
("one short clause each, no commentary"), which works because the
deterministic pre-grouping already collapses 23 messages into 12 entries.
Measured: **all 12 entries named, 41 words, 96 tokens** — same cost as the
detective's version (28.7 s vs 25.0 s warm), criterion intact.

**Agenda's node timeout is 50 s, not the proposed 45 s.** Every agenda figure
in section 2 came from an already-loaded model. A real morning call finds the
model unloaded: I measured that load at **6.0–6.2 s**. Cold 3-event cost is
6.2 (load) + 5.4 (prompt eval) + 20.0 (generation) = **31.6 s**, which is
exactly 70 % of 45 s — the detective's own pass threshold, with nothing left
for the ±8 % generation drift they measured (3.61–3.93 tok/s). At 50 s it is
63 %. 50 s + the 0.4 s Calendar fetch leaves 9.6 s under the gateway's 60 s
budget — the same shape as email-review's 8 s, no inversion. Checked
explicitly, since an inversion is the P0 scenario: **45 s… 50 s < 60 s** and
**75 s + 6.9 s < 90 s**.

**`num_predict` needed a guard behind it.** Lowering it is what buys the time,
but it is a hard token stop: at 6 events the tightened agenda prompt came back
`done_reason: "length"`, cut mid-word ("…from 14:00 to 15:00 in Room"), 49
words — comfortably **under** the 130-word cap, so the old `Finalize Reply`
would have spoken half a sentence to the user. That is a defect proposal A
introduces and section 2 does not mention. Hence the `done_reason: 'length'`
check: a cut answer is a failure, the deterministic text answers instead. This
is what makes a small `num_predict` safe, and it is the one piece of the fix
that must not be "simplified" away later.

**Ruled out:** switching to `qwen2.5:3b` (option B — the user deferred it; the
prompts were tuned live on 7b and it is its own feature); raising timeouts to
fit the current output (option C — section 2's reasoning stands, and the
gateway-budget inversion it risks is the P0 case); reducing how many events
the model must name in `agenda` (it would fit the budget at any event count,
but it contradicts FEAT-002's "naming each event with its time range" — see
the flag below, this one is the user's call, not mine).

### Verification

All measurements are against the **real** `qwen2.5:7b` on this host, using the
byte-exact `ollamaBody` lifted out of stored execution 48 (23 unread → 6
individual + 6 grouped senders). Warm-vs-cold is stated per row: `load_s > 0`
means the model was genuinely unloaded, which is the case that matters.

_1. Counter-test — the old values, live, right now._ Same harness, only
requirement 5 and `num_predict` restored to the shipped values (the working
tree was never reverted):

```
{"variant":"asis","http":200,"wall_s":100.2,"load_s":6.2,"prompt_eval":697,"prompt_eval_s":10.7,"eval_tokens":302,"eval_s":83.2,"done_reason":"stop","words":150,"entities_named":12}
{"variant":"v2",  "http":200,"wall_s": 28.7,"load_s":0.3,"prompt_eval":722,"prompt_eval_s": 2.1,"eval_tokens": 96,"eval_s":26.2,"done_reason":"stop","words": 41,"entities_named":12}
```

100.2 s against a 75 s node timeout — the bug reappears the moment the old
numbers go back. So the improvement is this change and nothing else.

_2. The fix, cold._ First call after the model had unloaded:

```
{"variant":"v2","wall_s":42.9,"load_s":6.0,"prompt_eval":722,"prompt_eval_s":10.8,"eval_tokens":96,"eval_s":26.1,"done_reason":"stop","words":41,"entities_named":12,"entities_missing":[]}
{"variant":"v1","wall_s":25.0,"load_s":0.3,"eval_tokens":92,"done_reason":"stop","words":44,"entities_named":12}
{"variant":"v2","wall_s":29.2,"load_s":0.4,"eval_tokens":96,"done_reason":"stop","words":41,"entities_named":12}
```

**42.9 s cold = 57 % of the 75 s node timeout** (criterion 3 asks for < 70 %),
28.7–29.2 s warm. Plus the 6.9 s Gmail fetch: 49.8 s against the gateway's
90 s. `entities_missing: []` on every run — all 12 senders/groups named, so
FEAT-003's criterion survives the shortening.

_3. Agenda — synthetic replay, and this is as far as I could honestly go._
`agenda.json`'s `Format Rundown` and `Build Summary Prompt` replayed verbatim
over synthetic events (creating a real calendar event is the user's call, so
this is **not** a real round trip — the only untested part is the ~0.4 s
Calendar fetch):

```
as-is 100w/np220, 6 events : wall 48.5s  prompt_eval 437(7.0s)  eval 154(41.0s)  stop    69 words
new    60w/np120, 6 events : wall 32.1s  prompt_eval 446(0.9s)  eval 120(30.8s)  LENGTH  48 words  <-- truncated
new    60w/np120, 3 events : wall 25.8s  prompt_eval 376(5.4s)  eval  83(20.0s)  stop    41 words  3/3 events named
       50w/np100, 6 events : wall 29.0s  prompt_eval 446(0.9s)  eval 100(27.7s)  LENGTH  49 words  <-- truncated
```

3-event day, cold: 6.2 + 5.4 + 20.0 = **31.6 s = 63 % of the 50 s timeout**.
The as-is 6-event run at 48.5 s against the old 30 s timeout is the
counter-test for this workflow. (The "5/6 events named" my harness printed for
the as-is run is the harness under-counting — the model wrote `9:00`, not
`09:00`; the reply does name all six.)

_4. Both `Finalize Reply` nodes, every degradation path._ Harness that loads
the Code node **out of the repo JSON** and runs it (so what is checked is what
n8n would execute), against the five shapes the node can receive:

```
--- email-review Finalize Reply ---
ok                 -> summarized=true  reply="Un resumen b" summaryError=undefined | log: (none)
node timeout       -> summarized=false reply="RAW LIST" summaryError="ollama request failed: timeout of 75000ms exceeded"     | log: [email-review] fell back to the deterministic list — ollama request failed: timeout of 75000ms exceeded
empty response     -> summarized=false reply="RAW LIST" summaryError="ollama answered without a response field"               | log: [email-review] fell back to the deterministic list — ollama answered without a response field
truncated by cap   -> summarized=false reply="RAW LIST" summaryError="ollama answer truncated at num_predict (150 tokens)"    | log: [email-review] fell back to the deterministic list — ollama answer truncated at num_predict (150 tokens)
runaway (>WORDCAP) -> summarized=false reply="RAW LIST" summaryError="ollama answer of 400 words exceeds the 350-word guard"  | log: [email-review] fell back to the deterministic list — ollama answer of 400 words exceeds the 350-word guard

--- agenda Finalize Reply ---   (same five, reply="RAW RUNDOWN", "…exceeds the 130-word cap")
```

The user-facing contract is unchanged on every path: `ok: true`, non-empty
reply, never an error. The only additions are `summaryError` and the log line.

_5. What the workflow files actually contain_ (read back from the JSON, not
from the diff):

```
agenda.json       | node timeout: 50000 | num_predict: 140 | word rule: 4. Under 60 words in total — one short clause per event and no comme…
email-review.json | node timeout: 75000 | num_predict: 150 | word rule: 5. Be brief — this answer is read aloud. Stay UNDER 90 WORDS in total:…
email-review req 4 intact: true
```

_6. Project checks._ `pnpm typecheck` → 3 tasks successful. `pnpm lint` →
clean. `pnpm test` → 87 passed (3 files). `pnpm format` → the only warning is
this dossier, reformatted with `prettier --write` on this file alone.

### What is NOT verified — the auditor should start here

1. **Nothing ran through the live n8n.** `docker cp` + `n8n import:workflow`
   were denied by this session's permission classifier. The live container
   still executes the pre-fix definitions, so a `POST /command` right now
   reproduces the **old** behaviour, not the fix. **The user must run:**

   ```bash
   docker cp infra/n8n/workflows/email-review.json xavi-assistant-n8n-1:/tmp/email-review.json
   docker cp infra/n8n/workflows/agenda.json       xavi-assistant-n8n-1:/tmp/agenda.json
   docker exec xavi-assistant-n8n-1 n8n import:workflow --input=/tmp/email-review.json
   docker exec xavi-assistant-n8n-1 n8n import:workflow --input=/tmp/agenda.json
   docker exec xavi-assistant-n8n-1 n8n publish:workflow --id=XaviEmailRev0001
   docker exec xavi-assistant-n8n-1 n8n publish:workflow --id=XaviAgenda000001
   docker restart xavi-assistant-n8n-1     # activation does not take effect until this
   docker exec xavi-assistant-n8n-1 n8n list:workflow   # confirm both are active
   ```

   Until the restart, section 2's "how to prove it's done" cannot be run at
   all. Everything above is repo-side plus real Ollama timings.

2. **`num_predict: 140` itself was never measured** — 120 and 100 were. At 3
   events the answer stops on its own at 83 tokens, so 140 does not bind; at 6
   events it will either be cut (caught by the new guard) or the node will time
   out (caught by the fallback). Same outcome for the user either way, but the
   auditor should not read 140 as a measured number.

3. **Agenda has still never run end-to-end with real events.** Needs the user
   to create ≥ 3 calendar entries.

4. **The `console.log` line has never been seen in `docker logs`.** The Code
   node's stdout going to the container log is documented n8n behaviour for
   production executions, not something I observed here — it depends on the
   import above. If it does not appear, fix D is not delivered and this comes
   back to me.

5. **The Cloudflare Tunnel's ~100 s edge cut** (section 2's open question) is
   still unmeasured. It no longer matters much: the worst case is now ~50 s
   (agenda) and ~50 s (email-review incl. Gmail), both well under it.

### Flag for the user — a narrowing I did not make silently

FEAT-002's criterion is "reply … **naming each event** with its time range
and, when the calendar entry has one, its location or link", plus "≤ ~120
words". The 60-word target keeps the word criterion true (it is a cap). The
naming criterion is where the honest limit sits: **on a day of roughly 5
events or more, `qwen2.5:7b` cannot name them all inside any node timeout that
still fits under the gateway's 60 s budget** — 6 events costs 48.5 s of
generation alone. Those days will fall back to the deterministic rundown,
which _does_ name every event with time and location (up to 8) and is now
logged rather than silent. So the criterion holds, but via the fallback rather
than via the LLM.

The two ways to change that are both the user's call and neither belongs in
this bug: `qwen2.5:3b` (option B, already deferred), or telling the model to
name only the first N events and say how many more there are — which the
shipped requirement 4 already sanctions as an escape hatch but which would
narrow a delivered promise, so I did not make it deterministic on my own.

### Risks

- **Shorter, drier summaries.** email-review went from ~150 words to ~41 on
  the same inbox; agenda from ~69 to ~41 on a 3-event day. Everything is still
  named, but there is no room left for nuance. This is what the hardware
  affords at a latency a voice assistant can use.
- **`num_predict` is now close to the real answer length** (150 vs 96, 140 vs
  83). A chattier day trips the truncation guard and falls back — visibly now,
  but it falls back. If that turns out to be frequent, the fix is a bigger
  `num_predict` _plus_ a re-measurement, not a bigger timeout.
- **`summaryError` is a new field** in `skillResult`. Additive and optional;
  the gateway folds `skillResult` through as `unknown` and only reads `reply`,
  so nothing downstream can break on it. The shared types were updated to
  match.
- **Agenda's 30 s → 50 s** means a failing agenda call now keeps the caller
  waiting 20 s longer before delivering the fallback. Accepted: it is the
  difference between summarizing and not.
- Nothing in the fix touches Gmail, Calendar, the grouping, the fallback text
  or the privacy rule — no email or calendar content reaches the new log line,
  only the reason string.

**Tree state:** uncommitted. Modified:
`infra/n8n/workflows/email-review.json`, `infra/n8n/workflows/agenda.json`,
`packages/shared/src/index.ts`, `apps/gateway/src/skills.ts` (comments only),
this dossier and `docs/bugs/QUEUE.md`. Nothing imported into the live n8n,
nothing committed, nothing pushed.

## 4. Audit — bug-auditor
