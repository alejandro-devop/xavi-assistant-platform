import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  SKILL_UNAVAILABLE,
  type AgendaSkillResult,
  type CommandResponse,
  type EmailReviewSkillResult,
} from "@xavi/shared";
import { buildApp } from "./app.js";
import {
  KNOWN_INTENTS,
  UNKNOWN_INTENT,
  buildClassifierPrompt,
  fallbackUnknownReply,
  makeIntentCommandHandler,
  makeIntentDetector,
  parseDetection,
} from "./intent.js";
import { skillUnavailableReply, type SkillDispatchOutcome } from "./skills.js";

/** Fake skill dispatcher answering `outcome`; records calls for assertions. */
function makeFakeDispatch(
  outcome: SkillDispatchOutcome = { ok: true, result: { ok: true, reply: "pong" } },
) {
  return vi.fn(() => Promise.resolve(outcome));
}

const OLLAMA_URL = "http://ollama.test:11434";
const MODEL = "fake-model";

/** A successful Ollama /api/chat response whose assistant message is `content`. */
function chatResponse(content: string): Response {
  return new Response(JSON.stringify({ message: { role: "assistant", content } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

interface RecordedCall {
  url: string;
  body: Record<string, unknown>;
}

/** Fake fetch that answers the queued responses in order and records calls. */
function makeFakeFetch(responses: Array<Response | Error>) {
  const calls: RecordedCall[] = [];
  const fetchFn = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    const next = responses.shift();
    if (next === undefined) {
      throw new Error("fake fetch: no response queued");
    }
    return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
  });
  return { fetchFn: fetchFn as unknown as typeof fetch, calls };
}

function makeDetector(responses: Array<Response | Error>, warn = vi.fn()) {
  const { fetchFn, calls } = makeFakeFetch(responses);
  const detect = makeIntentDetector({ ollamaUrl: OLLAMA_URL, model: MODEL, fetchFn, warn });
  return { detect, calls, warn };
}

describe("parseDetection", () => {
  it("accepts the exact expected shape", () => {
    expect(parseDetection('{"intent":"ping","params":{}}')).toEqual({ intent: "ping", params: {} });
  });

  it("keeps extracted params", () => {
    expect(parseDetection('{"intent":"ping","params":{"target":"home"}}')).toEqual({
      intent: "ping",
      params: { target: "home" },
    });
  });

  it("coerces missing or non-object params to {}", () => {
    expect(parseDetection('{"intent":"ping"}')).toEqual({ intent: "ping", params: {} });
    expect(parseDetection('{"intent":"ping","params":"x"}')).toEqual({
      intent: "ping",
      params: {},
    });
    expect(parseDetection('{"intent":"ping","params":[1]}')).toEqual({
      intent: "ping",
      params: {},
    });
  });

  it.each([
    ["not JSON", "pong!"],
    ["a JSON array", "[1,2]"],
    ["JSON without intent", '{"foo":1}'],
    ["a non-string intent", '{"intent":42,"params":{}}'],
    ["an empty intent", '{"intent":"","params":{}}'],
  ])("rejects %s", (_name, raw) => {
    expect(parseDetection(raw)).toBeUndefined();
  });
});

describe("makeIntentDetector", () => {
  it("POSTs /api/chat with model, format json, stream false and both messages", async () => {
    const { detect, calls } = makeDetector([chatResponse('{"intent":"ping","params":{}}')]);
    await detect("haz ping");
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toBe(`${OLLAMA_URL}/api/chat`);
    expect(call?.body.model).toBe(MODEL);
    expect(call?.body.format).toBe("json");
    expect(call?.body.stream).toBe(false);
    const messages = call?.body.messages as Array<{ role: string; content: string }>;
    expect(messages[0]).toEqual({ role: "system", content: buildClassifierPrompt(KNOWN_INTENTS) });
    expect(messages[0]?.content).toContain('"ping"');
    expect(messages[1]).toEqual({ role: "user", content: "haz ping" });
  });

  it("returns a registered intent verbatim, with its params", async () => {
    const { detect, warn } = makeDetector([
      chatResponse('{"intent":"ping","params":{"note":"hi"}}'),
    ]);
    await expect(detect("ping")).resolves.toEqual({ intent: "ping", params: { note: "hi" } });
    expect(warn).not.toHaveBeenCalled();
  });

  it('returns "unknown" without warning when the model says so', async () => {
    const { detect, warn } = makeDetector([chatResponse('{"intent":"unknown","params":{}}')]);
    await expect(detect("qué hora es")).resolves.toEqual({ intent: UNKNOWN_INTENT, params: {} });
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ["unparseable model output", chatResponse("I think this is a ping")],
    ["a wrong JSON shape", chatResponse('{"answer":"ping"}')],
    ["an unregistered intent name", chatResponse('{"intent":"weather","params":{}}')],
    ["a non-2xx Ollama answer", new Response("boom", { status: 500 })],
    ["a network failure", new Error("ECONNREFUSED")],
    ["a body that is not Ollama's shape", new Response("[]", { status: 200 })],
  ])('falls back to "unknown" and logs on %s — never throws', async (_name, response) => {
    const { detect, warn } = makeDetector([response]);
    await expect(detect("whatever")).resolves.toEqual({ intent: UNKNOWN_INTENT, params: {} });
    expect(warn).toHaveBeenCalledOnce();
  });
});

describe("makeIntentCommandHandler", () => {
  it("a detected intent dispatches once with {text, params} and folds the result into skillResult", async () => {
    const { fetchFn, calls } = makeFakeFetch([
      chatResponse('{"intent":"ping","params":{"note":"hi"}}'),
    ]);
    const dispatch = makeFakeDispatch({ ok: true, result: { ok: true, reply: "pong" } });
    const handle = makeIntentCommandHandler({
      ollamaUrl: OLLAMA_URL,
      model: MODEL,
      fetchFn,
      dispatch,
    });
    const result = await handle("haz ping");
    expect(result).toEqual({
      ok: true,
      intent: "ping",
      reply: "pong", // the skill's own literal reply
      skillResult: { ok: true, reply: "pong" },
    });
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith("ping", { text: "haz ping", params: { note: "hi" } });
    // Exactly one Ollama call — the free-text reply generator never runs here.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`${OLLAMA_URL}/api/chat`);
  });

  it('a failed dispatch answers {ok:false, intent, error:"skill_unavailable"} with a bilingual reply', async () => {
    const { fetchFn } = makeFakeFetch([chatResponse('{"intent":"ping","params":{}}')]);
    const dispatch = makeFakeDispatch({ ok: false, error: SKILL_UNAVAILABLE });
    const handle = makeIntentCommandHandler({
      ollamaUrl: OLLAMA_URL,
      model: MODEL,
      fetchFn,
      dispatch,
    });
    await expect(handle("ping")).resolves.toEqual({
      ok: false,
      intent: "ping",
      error: SKILL_UNAVAILABLE,
      reply: skillUnavailableReply("ping"),
    });
  });

  it("an unknown intent triggers a second free-text Ollama call, uses its reply, and never dispatches", async () => {
    const { fetchFn, calls } = makeFakeFetch([
      chatResponse('{"intent":"unknown","params":{}}'),
      chatResponse("Aún no puedo hacer eso; por ahora solo puedo hacer ping."),
    ]);
    const dispatch = makeFakeDispatch();
    const handle = makeIntentCommandHandler({
      ollamaUrl: OLLAMA_URL,
      model: MODEL,
      fetchFn,
      dispatch,
    });
    await expect(handle("enciende la luz")).resolves.toEqual({
      ok: true,
      intent: UNKNOWN_INTENT,
      reply: "Aún no puedo hacer eso; por ahora solo puedo hacer ping.",
    });
    expect(dispatch).not.toHaveBeenCalled(); // unknown never reaches n8n
    expect(calls).toHaveLength(2);
    expect(calls[1]?.url).toBe(`${OLLAMA_URL}/api/chat`);
    expect(calls[1]?.body.format).toBeUndefined(); // free text, not JSON mode
    expect(calls[1]?.body.stream).toBe(false);
  });

  it("uses the static bilingual fallback when the reply call also fails — still no dispatch", async () => {
    const warn = vi.fn();
    const dispatch = makeFakeDispatch();
    const { fetchFn } = makeFakeFetch([chatResponse("total garbage"), new Error("ECONNREFUSED")]);
    const handle = makeIntentCommandHandler({
      ollamaUrl: OLLAMA_URL,
      model: MODEL,
      fetchFn,
      warn,
      dispatch,
    });
    const result = await handle("do something impossible");
    expect(result).toEqual({
      ok: true,
      intent: UNKNOWN_INTENT,
      reply: fallbackUnknownReply(KNOWN_INTENTS),
    });
    expect(result.reply).toContain("ping");
    expect(warn).toHaveBeenCalledTimes(2); // parse failure + reply-call failure
    expect(dispatch).not.toHaveBeenCalled();
  });
});

describe("end to end through the app (faked Ollama)", () => {
  let app: FastifyInstance | undefined;
  const TOKEN = "test-token-not-a-secret";
  const AUTH = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  function makeApp(
    responses: Array<Response | Error>,
    dispatch: ReturnType<typeof makeFakeDispatch> = makeFakeDispatch(),
  ): FastifyInstance {
    const { fetchFn } = makeFakeFetch(responses);
    app = buildApp({
      bearerToken: TOKEN,
      handleCommand: makeIntentCommandHandler({
        ollamaUrl: OLLAMA_URL,
        model: MODEL,
        fetchFn,
        warn: vi.fn(),
        dispatch,
      }),
    });
    return app;
  }

  it("POST /command answers 200 with the full shared shape (skillResult included) on a detected intent", async () => {
    const skillBody = { ok: true, reply: "pong", receivedText: "ping" };
    const dispatch = makeFakeDispatch({ ok: true, result: skillBody });
    const res = await makeApp([chatResponse('{"intent":"ping","params":{}}')], dispatch).inject({
      method: "POST",
      url: "/command",
      headers: AUTH,
      payload: { text: "ping" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as CommandResponse;
    expect(body.ok).toBe(true);
    expect(body.intent).toBe("ping");
    expect(body.reply).toBe("pong");
    expect(body.skillResult).toEqual(skillBody);
  });

  it("POST /command answers 502 {ok:false, intent, error} when the skill dispatch fails", async () => {
    const dispatch = makeFakeDispatch({ ok: false, error: SKILL_UNAVAILABLE });
    const res = await makeApp([chatResponse('{"intent":"ping","params":{}}')], dispatch).inject({
      method: "POST",
      url: "/command",
      headers: AUTH,
      payload: { text: "ping" },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({
      ok: false,
      intent: "ping",
      error: SKILL_UNAVAILABLE,
      reply: skillUnavailableReply("ping"),
    });
  });

  it("model garbage still answers 200 unknown — never a 500", async () => {
    const res = await makeApp([
      chatResponse("<<<not json at all>>>"),
      new Error("Ollama also down for the reply"),
    ]).inject({
      method: "POST",
      url: "/command",
      headers: AUTH,
      payload: { text: "hola, ¿me pones música?" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as CommandResponse;
    expect(body).toEqual({
      ok: true,
      intent: UNKNOWN_INTENT,
      reply: fallbackUnknownReply(KNOWN_INTENTS),
    });
  });

  it("routes a detected agenda intent to dispatch and folds the AgendaSkillResult (FEAT-002)", async () => {
    const agendaBody: AgendaSkillResult = {
      ok: true,
      reply: "Today (2026-08-15) you have 1 event / Hoy tienes 1 evento:\n- 09:00-09:30: Standup",
      eventCount: 1,
      date: "2026-08-15",
    };
    const dispatch = makeFakeDispatch({ ok: true, result: agendaBody });
    const res = await makeApp([chatResponse('{"intent":"agenda","params":{}}')], dispatch).inject({
      method: "POST",
      url: "/command",
      headers: AUTH,
      payload: { text: "what's on my plate today?" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as CommandResponse;
    expect(body.ok).toBe(true);
    expect(body.intent).toBe("agenda");
    expect(body.reply).toBe(agendaBody.reply);
    expect(body.skillResult).toEqual(agendaBody);
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith("agenda", {
      text: "what's on my plate today?",
      params: {},
    });
  });

  it("answers 502 skill_unavailable when the agenda dispatch fails — FEAT-002's own webhook path", async () => {
    const dispatch = makeFakeDispatch({ ok: false, error: SKILL_UNAVAILABLE });
    const res = await makeApp([chatResponse('{"intent":"agenda","params":{}}')], dispatch).inject({
      method: "POST",
      url: "/command",
      headers: AUTH,
      payload: { text: "qué tengo hoy?" },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({
      ok: false,
      intent: "agenda",
      error: SKILL_UNAVAILABLE,
      reply: skillUnavailableReply("agenda"),
    });
  });

  it("routes a detected email_review intent to dispatch and folds the EmailReviewSkillResult (FEAT-003)", async () => {
    const emailBody: EmailReviewSkillResult = {
      ok: true,
      reply:
        "You have 2 unread emails from the last 24 hours / Tienes 2 correos sin leer de las últimas 24 horas:\n- 09:15: Ana — Budget\n- 14:05: Deals Bot — Offer",
      messageCount: 2,
      capReached: false,
    };
    const dispatch = makeFakeDispatch({ ok: true, result: emailBody });
    const res = await makeApp(
      [chatResponse('{"intent":"email_review","params":{}}')],
      dispatch,
    ).inject({
      method: "POST",
      url: "/command",
      headers: AUTH,
      payload: { text: "check my email" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as CommandResponse;
    expect(body.ok).toBe(true);
    expect(body.intent).toBe("email_review");
    expect(body.reply).toBe(emailBody.reply);
    expect(body.skillResult).toEqual(emailBody);
    expect(dispatch).toHaveBeenCalledOnce();
    expect(dispatch).toHaveBeenCalledWith("email_review", {
      text: "check my email",
      params: {},
    });
  });

  it("answers 502 skill_unavailable when the email_review dispatch fails — FEAT-003's own webhook path", async () => {
    const dispatch = makeFakeDispatch({ ok: false, error: SKILL_UNAVAILABLE });
    const res = await makeApp(
      [chatResponse('{"intent":"email_review","params":{}}')],
      dispatch,
    ).inject({
      method: "POST",
      url: "/command",
      headers: AUTH,
      payload: { text: "revisa mi correo" },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({
      ok: false,
      intent: "email_review",
      error: SKILL_UNAVAILABLE,
      reply: skillUnavailableReply("email_review"),
    });
  });
});

describe("email_review in the capability surface (FEAT-003)", () => {
  it("the classifier prompt lists email_review alongside ping and agenda", () => {
    const prompt = buildClassifierPrompt(KNOWN_INTENTS);
    expect(prompt).toContain('"ping"');
    expect(prompt).toContain('"agenda"');
    expect(prompt).toContain('"email_review"');
  });

  it("the static unknown-intent capability reply lists email_review alongside ping and agenda", () => {
    const reply = fallbackUnknownReply(KNOWN_INTENTS);
    expect(reply).toContain("ping");
    expect(reply).toContain("agenda");
    expect(reply).toContain("email_review");
  });
});

describe("agenda in the capability surface (FEAT-002)", () => {
  it("the classifier prompt lists agenda alongside ping", () => {
    const prompt = buildClassifierPrompt(KNOWN_INTENTS);
    expect(prompt).toContain('"ping"');
    expect(prompt).toContain('"agenda"');
  });

  it("the static unknown-intent capability reply lists agenda alongside ping", () => {
    const reply = fallbackUnknownReply(KNOWN_INTENTS);
    expect(reply).toContain("ping");
    expect(reply).toContain("agenda");
  });
});
