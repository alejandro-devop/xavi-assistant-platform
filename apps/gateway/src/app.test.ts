import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { CommandResponse } from "@xavi/shared";
import { buildApp, type CommandHandler } from "./app.js";
import { loadConfig } from "./config.js";

const TOKEN = "test-token-not-a-secret";
const AUTH = { authorization: `Bearer ${TOKEN}` };

/** Handler stand-in: `buildApp` requires one since slice 2 (no echo default). */
const fakeEcho: CommandHandler = (text) =>
  Promise.resolve({ ok: true, intent: "fake-echo", reply: text });

let app: FastifyInstance | undefined;

function makeApp(handleCommand: CommandHandler = fakeEcho): FastifyInstance {
  app = buildApp({ bearerToken: TOKEN, handleCommand });
  return app;
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("GET /healthz", () => {
  it("answers 200 {status:'ok'} without auth", async () => {
    const res = await makeApp().inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
});

describe("POST /command auth", () => {
  it.each([
    ["missing Authorization header", {}],
    ["wrong token", { authorization: "Bearer wrong-token" }],
    ["wrong scheme", { authorization: `Basic ${TOKEN}` }],
    ["token of a different length", { authorization: `Bearer ${TOKEN}x` }],
  ])("401 on %s, with a generic body", async (_name, headers) => {
    const res = await makeApp().inject({
      method: "POST",
      url: "/command",
      headers: { "content-type": "application/json", ...headers },
      payload: { text: "hola" },
    });
    expect(res.statusCode).toBe(401);
    // Exact-match the body: nothing about the expected token, no stack, no hint.
    expect(res.json()).toEqual({ error: "unauthorized" });
    expect(res.body).not.toContain(TOKEN);
  });

  it("401 wins over validation: bad body without auth is still 401", async () => {
    const res = await makeApp().inject({
      method: "POST",
      url: "/command",
      headers: { "content-type": "application/json" },
      payload: {},
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "unauthorized" });
  });
});

describe("POST /command body validation", () => {
  it.each([
    ["missing text", {}],
    ["empty text", { text: "" }],
    ["non-string text", { text: 42 }],
  ])("400 on %s", async (_name, payload) => {
    const res = await makeApp().inject({
      method: "POST",
      url: "/command",
      headers: { "content-type": "application/json", ...AUTH },
      payload,
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { message?: string };
    expect(typeof body.message).toBe("string");
  });
});

describe("POST /command happy path", () => {
  it("200 answering the handler's result in the shared CommandResponse shape", async () => {
    const res = await makeApp().inject({
      method: "POST",
      url: "/command",
      headers: { "content-type": "application/json", ...AUTH },
      payload: { text: "enciende la luz" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as CommandResponse;
    expect(body).toEqual({ ok: true, intent: "fake-echo", reply: "enciende la luz" });
  });

  it("uses the injected command handler (the seam for slices 2-3)", async () => {
    const fake = (text: string): Promise<CommandResponse> =>
      Promise.resolve({ ok: true, intent: "fake", reply: `got: ${text}` });
    const res = await makeApp(fake).inject({
      method: "POST",
      url: "/command",
      headers: { "content-type": "application/json", ...AUTH },
      payload: { text: "ping" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, intent: "fake", reply: "got: ping" });
  });

  it("maps a handler result with ok:false to HTTP 502 (skill dispatch failed)", async () => {
    const failing: CommandHandler = () =>
      Promise.resolve({
        ok: false,
        intent: "ping",
        reply: "unavailable",
        error: "skill_unavailable",
      });
    const res = await makeApp(failing).inject({
      method: "POST",
      url: "/command",
      headers: { "content-type": "application/json", ...AUTH },
      payload: { text: "ping" },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({
      ok: false,
      intent: "ping",
      reply: "unavailable",
      error: "skill_unavailable",
    });
  });
});

describe("loadConfig", () => {
  it("fails fast when GATEWAY_BEARER_TOKEN is unset or empty", () => {
    expect(() => loadConfig({})).toThrow(/GATEWAY_BEARER_TOKEN/);
    expect(() => loadConfig({ GATEWAY_BEARER_TOKEN: "" })).toThrow(/GATEWAY_BEARER_TOKEN/);
  });

  it("returns the settled port/host with the token and the Ollama/n8n defaults", () => {
    expect(loadConfig({ GATEWAY_BEARER_TOKEN: "abc" })).toEqual({
      port: 8787,
      host: "127.0.0.1",
      bearerToken: "abc",
      ollamaUrl: "http://localhost:11434",
      ollamaModel: "qwen2.5:7b",
      n8nWebhookBase: "http://localhost:5679/webhook",
    });
  });

  it("honors OLLAMA_URL and OLLAMA_MODEL when set and non-empty", () => {
    const config = loadConfig({
      GATEWAY_BEARER_TOKEN: "abc",
      OLLAMA_URL: "http://ollama.internal:11434",
      OLLAMA_MODEL: "llama3.2:3b",
    });
    expect(config.ollamaUrl).toBe("http://ollama.internal:11434");
    expect(config.ollamaModel).toBe("llama3.2:3b");
    expect(loadConfig({ GATEWAY_BEARER_TOKEN: "abc", OLLAMA_URL: "" }).ollamaUrl).toBe(
      "http://localhost:11434",
    );
  });

  it("honors N8N_WEBHOOK_BASE when set and non-empty", () => {
    expect(
      loadConfig({ GATEWAY_BEARER_TOKEN: "abc", N8N_WEBHOOK_BASE: "http://n8n.internal/webhook" })
        .n8nWebhookBase,
    ).toBe("http://n8n.internal/webhook");
    expect(loadConfig({ GATEWAY_BEARER_TOKEN: "abc", N8N_WEBHOOK_BASE: "" }).n8nWebhookBase).toBe(
      "http://localhost:5679/webhook",
    );
  });
});
