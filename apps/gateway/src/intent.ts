/**
 * Intent detection via the local Ollama server (slice 2).
 *
 * Two collaborating pieces:
 *
 * - `makeIntentDetector` — one strict-JSON classification call
 *   (`/api/chat` with `format: "json"`): the model must answer ONLY
 *   `{"intent": "<registered name or unknown>", "params": {}}`. Every failure
 *   mode (server down, non-2xx, unparseable output, wrong shape,
 *   unregistered intent name) collapses to `"unknown"` — logged, never
 *   thrown, so `/command` can never 500 from here.
 * - `makeUnknownReplyGenerator` — when the intent lands on `"unknown"`, a
 *   second free-text call asks the model for a polite capability-listing
 *   reply in the user's own language (this is what makes the reply mirror
 *   ES/EN input). If that call fails too, a static bilingual fallback lists
 *   the capabilities without an LLM.
 *
 * `makeIntentCommandHandler` glues both into the `CommandHandler` seam that
 * `buildApp` takes. No n8n dispatch happens here — that's slice 3.
 */
import type { CommandResponse, IntentDetection } from "@xavi/shared";
import type { CommandHandler } from "./app.js";
import {
  SKILLS,
  replyForSkillResult,
  skillUnavailableReply,
  type SkillDispatcher,
} from "./skills.js";

/** An intent the gateway can recognize. */
export interface IntentDescriptor {
  readonly name: string;
  /** One line, shown to the classifier and (via the LLM) to the user. */
  readonly description: string;
}

/**
 * The registry the classifier chooses from. Since slice 3 this aliases the
 * skill registry (`skills.ts`), so intents and webhook routes cannot drift.
 */
export const KNOWN_INTENTS: readonly IntentDescriptor[] = SKILLS;

export const UNKNOWN_INTENT = "unknown";

export interface IntentDetectorOptions {
  /** Ollama base URL, e.g. `http://localhost:11434`. */
  ollamaUrl: string;
  /** Model name, e.g. `qwen2.5:7b`. */
  model: string;
  /** Intent registry to classify against. Defaults to `KNOWN_INTENTS`. */
  intents?: readonly IntentDescriptor[];
  /** Injected for tests. Defaults to global `fetch`. */
  fetchFn?: typeof fetch;
  /**
   * Per-call timeout. Defaults to 30s — a cold model load can far exceed the
   * 5s the n8n skill calls use (that limit is a slice-3 criterion, not this).
   */
  timeoutMs?: number;
  /** Where parse/call failures get logged. Defaults to `console.warn`. */
  warn?: (message: string) => void;
}

export type IntentDetector = (text: string) => Promise<IntentDetection>;

const DEFAULT_TIMEOUT_MS = 30_000;

export function buildClassifierPrompt(intents: readonly IntentDescriptor[]): string {
  const list = intents.map((i) => `- "${i.name}": ${i.description}`).join("\n");
  const names = [...intents.map((i) => i.name), UNKNOWN_INTENT]
    .map((name) => `"${name}"`)
    .join(" or ");
  return [
    "You are the intent classifier for Xavi, a personal assistant.",
    "These are the only intents Xavi knows:",
    list,
    "Classify the user's message. Answer ONLY with JSON in this exact shape:",
    `{"intent": <${names}>, "params": {}}`,
    'Put any parameters extracted from the message inside "params" (an empty object when there are none).',
    `If the message is ambiguous or matches no known intent, answer {"intent": "${UNKNOWN_INTENT}", "params": {}}.`,
    "Never write anything outside the JSON object.",
  ].join("\n");
}

function buildUnknownReplyPrompt(intents: readonly IntentDescriptor[]): string {
  const list = intents.map((i) => `- "${i.name}": ${i.description}`).join("\n");
  // Tuned live against qwen2.5:7b (2026-08-15): a single "same language"
  // instruction was ignored (English input got a Spanish reply) and the
  // capability list was dropped; the numbered requirements with the bilingual
  // language clause fixed both, 4/4 on ES/EN test inputs.
  return [
    "You are Xavi, a personal assistant.",
    "The user's message asked for something you cannot do yet.",
    "The ONLY things you can currently do are:",
    list,
    "Write a short polite answer (one or two sentences) that:",
    "1. Says you cannot do that yet.",
    "2. Mentions the things you CAN currently do (the list above).",
    "3. Is written in the SAME LANGUAGE as the user's message: if the user wrote in English, answer in English; si el usuario escribió en español, responde en español.",
    "Plain text only — no JSON, no markdown.",
  ].join("\n");
}

/** Static bilingual fallback for when even the reply LLM call fails. */
export function fallbackUnknownReply(intents: readonly IntentDescriptor[]): string {
  const names = intents.map((i) => i.name).join(", ");
  return (
    `Sorry, I can't do that yet. Right now I can only handle: ${names}. / ` +
    `Lo siento, aún no puedo hacer eso. Por ahora solo puedo: ${names}.`
  );
}

interface ChatMessage {
  role: "system" | "user";
  content: string;
}

/** One `/api/chat` round trip; returns the assistant message content. Throws on any transport/HTTP/shape problem — callers map that to their fallback. */
async function ollamaChat(
  options: Required<Pick<IntentDetectorOptions, "ollamaUrl" | "model" | "fetchFn" | "timeoutMs">>,
  messages: ChatMessage[],
  format?: "json",
): Promise<string> {
  const url = new URL("/api/chat", options.ollamaUrl);
  const response = await options.fetchFn(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: options.model,
      messages,
      stream: false,
      ...(format === undefined ? {} : { format }),
    }),
    signal: AbortSignal.timeout(options.timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`Ollama answered HTTP ${String(response.status)}`);
  }
  const data: unknown = await response.json();
  const content =
    typeof data === "object" && data !== null
      ? (data as { message?: { content?: unknown } }).message?.content
      : undefined;
  if (typeof content !== "string") {
    throw new Error("Ollama response has no message.content string");
  }
  return content;
}

/**
 * Parse the model's raw output into an `IntentDetection`, or `undefined` when
 * it is not JSON / not an object / has no string `intent`. A `params` that is
 * missing or not a plain object is coerced to `{}` (the intent still counts).
 */
export function parseDetection(raw: string): IntentDetection | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  const { intent, params } = parsed as { intent?: unknown; params?: unknown };
  if (typeof intent !== "string" || intent === "") {
    return undefined;
  }
  const validParams =
    typeof params === "object" && params !== null && !Array.isArray(params)
      ? (params as Record<string, unknown>)
      : {};
  return { intent, params: validParams };
}

function truncate(text: string, max = 200): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function resolveOptions(options: IntentDetectorOptions) {
  return {
    ollamaUrl: options.ollamaUrl,
    model: options.model,
    intents: options.intents ?? KNOWN_INTENTS,
    fetchFn: options.fetchFn ?? fetch,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    warn: options.warn ?? ((message: string) => console.warn(message)),
  };
}

export function makeIntentDetector(options: IntentDetectorOptions): IntentDetector {
  const resolved = resolveOptions(options);
  const prompt = buildClassifierPrompt(resolved.intents);
  const registered = new Set(resolved.intents.map((i) => i.name));
  return async (text) => {
    let content: string;
    try {
      content = await ollamaChat(
        resolved,
        [
          { role: "system", content: prompt },
          { role: "user", content: text },
        ],
        "json",
      );
    } catch (err) {
      resolved.warn(
        `intent detection: Ollama call failed, falling back to "unknown": ${String(err)}`,
      );
      return { intent: UNKNOWN_INTENT, params: {} };
    }
    const detection = parseDetection(content);
    if (detection === undefined) {
      resolved.warn(
        `intent detection: model output failed to parse, falling back to "unknown". Raw output: ${truncate(content)}`,
      );
      return { intent: UNKNOWN_INTENT, params: {} };
    }
    if (detection.intent !== UNKNOWN_INTENT && !registered.has(detection.intent)) {
      resolved.warn(
        `intent detection: model answered unregistered intent "${truncate(detection.intent, 50)}", falling back to "unknown"`,
      );
      return { intent: UNKNOWN_INTENT, params: {} };
    }
    return detection;
  };
}

/**
 * Reply for an unrecognized command: asks the LLM to list Xavi's current
 * capabilities in the user's language; falls back to a static bilingual line
 * if that call fails. Never throws.
 */
export function makeUnknownReplyGenerator(
  options: IntentDetectorOptions,
): (text: string) => Promise<string> {
  const resolved = resolveOptions(options);
  const prompt = buildUnknownReplyPrompt(resolved.intents);
  return async (text) => {
    try {
      const content = await ollamaChat(resolved, [
        { role: "system", content: prompt },
        { role: "user", content: text },
      ]);
      const reply = content.trim();
      if (reply === "") {
        throw new Error("model returned an empty reply");
      }
      return reply;
    } catch (err) {
      resolved.warn(
        `unknown-intent reply: Ollama call failed, using static fallback: ${String(err)}`,
      );
      return fallbackUnknownReply(resolved.intents);
    }
  };
}

export interface IntentCommandHandlerOptions extends IntentDetectorOptions {
  /**
   * Required since slice 3: routes a detected intent to its n8n webhook
   * (`makeSkillDispatcher` in production, a fake in tests). The slice-2
   * acknowledgement default is gone on purpose — a gateway that recognizes
   * intents without dispatching them would be a bug.
   */
  dispatch: SkillDispatcher;
}

/**
 * The real `/command` handler: detect the intent, then either answer the
 * unknown-intent capability reply (no n8n call) or dispatch to the matching
 * n8n webhook and fold its answer into `skillResult`. A failed dispatch
 * answers `{ok: false, error: "skill_unavailable"}`, which `app.ts` maps to
 * HTTP 502.
 */
export function makeIntentCommandHandler(options: IntentCommandHandlerOptions): CommandHandler {
  const detect = makeIntentDetector(options);
  const unknownReply = makeUnknownReplyGenerator(options);
  const { dispatch } = options;
  return async (text): Promise<CommandResponse> => {
    const detection = await detect(text);
    if (detection.intent === UNKNOWN_INTENT) {
      return { ok: true, intent: UNKNOWN_INTENT, reply: await unknownReply(text) };
    }
    const outcome = await dispatch(detection.intent, { text, params: detection.params });
    if (!outcome.ok) {
      return {
        ok: false,
        intent: detection.intent,
        error: outcome.error,
        reply: skillUnavailableReply(detection.intent),
      };
    }
    return {
      ok: true,
      intent: detection.intent,
      reply: replyForSkillResult(detection.intent, outcome.result),
      skillResult: outcome.result,
    };
  };
}
