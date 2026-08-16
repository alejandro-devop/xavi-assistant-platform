import { describe, expect, it, vi } from "vitest";
import { SKILL_UNAVAILABLE, type SkillRequest } from "@xavi/shared";
import {
  DEFAULT_SKILL_TIMEOUT_MS,
  SKILLS,
  makeSkillDispatcher,
  replyForSkillResult,
  skillUnavailableReply,
  webhookUrl,
} from "./skills.js";
import { KNOWN_INTENTS } from "./intent.js";

const BASE = "http://n8n.test:5679/webhook";
const REQUEST: SkillRequest = { text: "ping", params: {} };

/** A successful webhook response with the given JSON body. */
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

/** Fake fetch answering the queued responses in order and recording calls. */
function makeFakeFetch(responses: Array<Response | Error>) {
  const calls: RecordedCall[] = [];
  const fetchFn = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = responses.shift();
    if (next === undefined) {
      throw new Error("fake fetch: no response queued");
    }
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
  return { fetchFn: fetchFn as unknown as typeof fetch, calls };
}

/** Fake fetch that never answers but honors the abort signal, like the real one. */
function hangingFetch(): typeof fetch {
  return ((_input: unknown, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(init.signal?.reason instanceof Error ? init.signal.reason : new Error("aborted"));
      });
    })) as unknown as typeof fetch;
}

function makeDispatcher(
  responses: Array<Response | Error>,
  extra: { timeoutMs?: number; warn?: ReturnType<typeof vi.fn> } = {},
) {
  const warn = extra.warn ?? vi.fn();
  const { fetchFn, calls } = makeFakeFetch(responses);
  const dispatch = makeSkillDispatcher({
    webhookBase: BASE,
    fetchFn,
    warn,
    ...(extra.timeoutMs === undefined ? {} : { timeoutMs: extra.timeoutMs }),
  });
  return { dispatch, calls, warn };
}

describe("SKILLS registry", () => {
  it("has a ping skill routed to the ping webhook path", () => {
    expect(SKILLS).toContainEqual(
      expect.objectContaining({ name: "ping", webhookPath: "ping" }) as unknown,
    );
  });

  it("has an agenda skill routed to the agenda webhook path (FEAT-002)", () => {
    expect(SKILLS).toContainEqual(
      expect.objectContaining({ name: "agenda", webhookPath: "agenda" }) as unknown,
    );
  });

  it("has an email_review skill routed to the email-review webhook path (FEAT-003)", () => {
    expect(SKILLS).toContainEqual(
      expect.objectContaining({ name: "email_review", webhookPath: "email-review" }) as unknown,
    );
  });

  it("gives agenda a 60s dispatch budget — past FEAT-002's measured 33.8s worst case (FEAT-004)", () => {
    expect(SKILLS.find((skill) => skill.name === "agenda")?.timeoutMs).toBe(60_000);
  });

  it("gives email_review a 90s dispatch budget — longer than agenda's, per FEAT-003 (FEAT-004)", () => {
    expect(SKILLS.find((skill) => skill.name === "email_review")?.timeoutMs).toBe(90_000);
  });

  it("leaves ping without a timeoutMs — still bound by the 5s default (FEAT-004)", () => {
    const ping = SKILLS.find((skill) => skill.name === "ping");
    expect(ping).toBeDefined();
    expect(ping?.timeoutMs).toBeUndefined();
  });

  it("is the same list the intent classifier uses — no drift possible", () => {
    expect(KNOWN_INTENTS).toBe(SKILLS);
  });
});

describe("webhookUrl", () => {
  it.each([
    ["plain join", "http://x:1/webhook", "ping", "http://x:1/webhook/ping"],
    ["trailing slash on base", "http://x:1/webhook/", "ping", "http://x:1/webhook/ping"],
    ["leading slash on path", "http://x:1/webhook", "/ping", "http://x:1/webhook/ping"],
    ["both", "http://x:1/webhook/", "/ping", "http://x:1/webhook/ping"],
  ])("%s", (_name, base, path, expected) => {
    expect(webhookUrl(base, path)).toBe(expected);
  });
});

describe("makeSkillDispatcher", () => {
  it("POSTs the SkillRequest as JSON to {base}/{webhookPath} with a timeout signal", async () => {
    const { dispatch, calls } = makeDispatcher([jsonResponse({ ok: true, reply: "pong" })]);
    const request: SkillRequest = { text: "haz ping", params: { source: "test" } };
    await dispatch("ping", request);
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toBe(`${BASE}/ping`);
    expect(call?.init?.method).toBe("POST");
    expect(call?.init?.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(String(call?.init?.body))).toEqual(request);
    expect(call?.init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("folds a 2xx JSON body into a successful outcome, without warning", async () => {
    const body = { ok: true, reply: "pong", receivedText: "ping", at: "2026-08-15T00:00:00Z" };
    const { dispatch, warn } = makeDispatcher([jsonResponse(body)]);
    await expect(dispatch("ping", REQUEST)).resolves.toEqual({ ok: true, result: body });
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ["the webhook being down (network error)", new Error("ECONNREFUSED")],
    ["a non-2xx answer", new Response("boom", { status: 500 })],
    ["a 404 (webhook not registered)", new Response("not found", { status: 404 })],
    ["a 2xx body that is not JSON", new Response("<html>oops</html>", { status: 200 })],
  ])(
    'maps %s to {ok:false, error:"skill_unavailable"} and logs — never throws',
    async (_name, response) => {
      const { dispatch, warn } = makeDispatcher([response]);
      await expect(dispatch("ping", REQUEST)).resolves.toEqual({
        ok: false,
        error: SKILL_UNAVAILABLE,
      });
      expect(warn).toHaveBeenCalledOnce();
    },
  );

  it("POSTs an agenda request to {base}/agenda — the new webhook path, not ping's", async () => {
    const { dispatch, calls } = makeDispatcher([
      jsonResponse({ ok: true, reply: "Today you have 0 events", eventCount: 0 }),
    ]);
    const request: SkillRequest = { text: "what's on my plate today?", params: {} };
    await expect(dispatch("agenda", request)).resolves.toEqual({
      ok: true,
      result: { ok: true, reply: "Today you have 0 events", eventCount: 0 },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${BASE}/agenda`);
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual(request);
  });

  it.each([
    ["down (network error)", new Error("ECONNREFUSED")],
    ["answering 404 (webhook not registered/active)", new Response("not found", { status: 404 })],
    ["answering 500", new Response("boom", { status: 500 })],
  ])(
    "maps the agenda webhook being %s to skill_unavailable — the 502 path holds for the new path specifically",
    async (_name, response) => {
      const { dispatch, warn } = makeDispatcher([response]);
      await expect(dispatch("agenda", { text: "qué tengo hoy?", params: {} })).resolves.toEqual({
        ok: false,
        error: SKILL_UNAVAILABLE,
      });
      expect(warn).toHaveBeenCalledOnce();
      expect(String(warn.mock.calls[0]?.[0])).toContain('"agenda"');
    },
  );

  it("POSTs an email_review request to {base}/email-review — hyphenated path, not the intent name", async () => {
    const body = {
      ok: true,
      reply: "You have 2 unread emails…",
      messageCount: 2,
      capReached: false,
    };
    const { dispatch, calls } = makeDispatcher([jsonResponse(body)]);
    const request: SkillRequest = { text: "check my email", params: {} };
    await expect(dispatch("email_review", request)).resolves.toEqual({ ok: true, result: body });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${BASE}/email-review`);
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual(request);
  });

  it.each([
    ["down (network error)", new Error("ECONNREFUSED")],
    ["answering 404 (webhook not registered/active)", new Response("not found", { status: 404 })],
    ["answering 500", new Response("boom", { status: 500 })],
  ])(
    "maps the email-review webhook being %s to skill_unavailable — the 502 path holds for the new path specifically",
    async (_name, response) => {
      const { dispatch, warn } = makeDispatcher([response]);
      await expect(
        dispatch("email_review", { text: "revisa mi correo", params: {} }),
      ).resolves.toEqual({
        ok: false,
        error: SKILL_UNAVAILABLE,
      });
      expect(warn).toHaveBeenCalledOnce();
      expect(String(warn.mock.calls[0]?.[0])).toContain('"email_review"');
    },
  );

  // FEAT-004: agenda/email_review carry their own 60s/90s budgets, so a
  // hanging-webhook test against the real registry would take minutes. The
  // no-hang-at-override behavior is proven with a small-override registry
  // below; here we prove the *real* entries' budgets reach the dispatch call,
  // via the timeout the failure log names on an instant network error.
  it.each([
    ["agenda", "qué tengo hoy?", "60000ms"],
    ["email_review", "check my email", "90000ms"],
  ])(
    "dispatches %s under its own registry budget, not the 5s default (FEAT-004)",
    async (intent, text, budget) => {
      const { dispatch, warn } = makeDispatcher([new Error("ECONNREFUSED")]);
      await expect(dispatch(intent, { text, params: {} })).resolves.toEqual({
        ok: false,
        error: SKILL_UNAVAILABLE,
      });
      expect(warn).toHaveBeenCalledOnce();
      expect(String(warn.mock.calls[0]?.[0])).toContain(budget);
    },
  );

  it("times out a hanging webhook at the skill's own timeoutMs, not the 5s default (FEAT-004)", async () => {
    const warn = vi.fn();
    const dispatch = makeSkillDispatcher({
      webhookBase: BASE,
      skills: [{ name: "slow_skill", description: "test", webhookPath: "slow", timeoutMs: 20 }],
      fetchFn: hangingFetch(),
      warn,
      // No dispatcher-wide timeoutMs: the default is 5000ms, so finishing
      // fast below proves the 20ms override was actually read.
    });
    const startedAt = Date.now();
    await expect(dispatch("slow_skill", { text: "go slow", params: {} })).resolves.toEqual({
      ok: false,
      error: SKILL_UNAVAILABLE,
    });
    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).toContain("20ms");
  });

  it("falls back to the dispatcher default when a skill's timeoutMs is not positive (FEAT-004)", async () => {
    const warn = vi.fn();
    const dispatch = makeSkillDispatcher({
      webhookBase: BASE,
      skills: [{ name: "bad_budget", description: "test", webhookPath: "bad", timeoutMs: 0 }],
      fetchFn: hangingFetch(),
      warn,
      timeoutMs: 20,
    });
    await expect(dispatch("bad_budget", { text: "x", params: {} })).resolves.toEqual({
      ok: false,
      error: SKILL_UNAVAILABLE,
    });
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).toContain("20ms");
  });

  it("times out a hanging webhook instead of waiting forever", async () => {
    const warn = vi.fn();
    const dispatch = makeSkillDispatcher({
      webhookBase: BASE,
      fetchFn: hangingFetch(),
      warn,
      timeoutMs: 20,
    });
    await expect(dispatch("ping", REQUEST)).resolves.toEqual({
      ok: false,
      error: SKILL_UNAVAILABLE,
    });
    expect(warn).toHaveBeenCalledOnce();
    expect(String(warn.mock.calls[0]?.[0])).toContain("20ms");
  });

  it("defaults the timeout to the 5s criterion budget", () => {
    expect(DEFAULT_SKILL_TIMEOUT_MS).toBe(5_000);
  });

  it("answers skill_unavailable (with a warning) for an intent with no registered webhook", async () => {
    const { dispatch, warn, calls } = makeDispatcher([]);
    await expect(dispatch("not-a-skill", REQUEST)).resolves.toEqual({
      ok: false,
      error: SKILL_UNAVAILABLE,
    });
    expect(warn).toHaveBeenCalledOnce();
    expect(calls).toHaveLength(0); // nothing was called over the network
  });
});

describe("replyForSkillResult", () => {
  it("uses the skill's own reply field when it is a non-empty string", () => {
    expect(replyForSkillResult("ping", { ok: true, reply: "pong" })).toBe("pong");
  });

  it.each([
    ["no reply field", { ok: true }],
    ["a non-string reply", { reply: 42 }],
    ["an empty reply", { reply: "  " }],
    ["a non-object result", "pong"],
    ["null", null],
  ])("falls back to a generic completion line on %s", (_name, result) => {
    const reply = replyForSkillResult("ping", result);
    expect(reply).toContain('"ping"');
    expect(reply).toContain("completed");
  });
});

describe("skillUnavailableReply", () => {
  it("names the skill and is bilingual (static, not LLM-generated)", () => {
    const reply = skillUnavailableReply("ping");
    expect(reply).toContain('"ping"');
    expect(reply).toContain("unavailable");
    expect(reply).toContain("no está disponible");
  });
});
