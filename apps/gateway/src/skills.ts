/**
 * Skill registry + n8n dispatcher (slice 3).
 *
 * `SKILLS` is the single canonical registry: each entry carries both what the
 * intent classifier needs (name, description — `intent.ts`'s `KNOWN_INTENTS`
 * aliases this list) and where dispatch goes (`webhookPath` under
 * `N8N_WEBHOOK_BASE`). One list means a recognizable intent without a webhook
 * route cannot exist by construction.
 *
 * `makeSkillDispatcher` POSTs the `SkillRequest` to the skill's webhook with
 * a hard timeout (default 5s — a FEAT-001 criterion; a skill may override it
 * via `SkillDescriptor.timeoutMs`, FEAT-004). Every failure mode
 * (server down, timeout, non-2xx, 2xx-but-not-JSON, unroutable intent)
 * collapses to `{ok: false, error: "skill_unavailable"}` — logged, never
 * thrown, so `/command` answers a clean 502 instead of hanging or crashing.
 */
import { SKILL_UNAVAILABLE, type SkillDescriptor, type SkillRequest } from "@xavi/shared";

/** The canonical skill registry. Phase 2 skills get appended here. */
export const SKILLS: readonly SkillDescriptor[] = [
  {
    name: "ping",
    description: "Health check: confirm Xavi is alive and responding.",
    webhookPath: "ping",
  },
  {
    name: "agenda",
    description:
      "Today's agenda: a time-ordered rundown of today's calendar events " +
      '("what\'s on my plate today?", "qué tengo hoy?").',
    webhookPath: "agenda",
    // FEAT-004: the workflow's in-n8n Ollama summarization measured 4.4–33.8s
    // warm (FEAT-002); ~2× the worst observation covers slow runs and a cold
    // model load stacking on top of generation.
    // BUG-001: these budgets are one chain and only move together —
    //   Ollama node timeout  <  this budget  <  the caller's patience.
    // The workflow's node now waits 50s (infra/n8n/workflows/agenda.json) plus
    // ~0.4s of Calendar fetch, leaving ~9s here. Never let a node timeout
    // reach this number: the gateway would abort first and the user would lose
    // even the deterministic fallback, which is the whole point of the design.
    timeoutMs: 60_000,
  },
  {
    name: "email_review",
    description:
      "Email review: a rundown of the unread inbox from the last 24 hours " +
      '("check my email", "revisa mi correo").',
    webhookPath: "email-review",
    // FEAT-004: expected slower than agenda — up to 25 items vs. 14 observed,
    // longer prioritization prompt (FEAT-003); agenda's 60s scaled by ~1.5×.
    // BUG-001: same chain rule as agenda. The workflow's Ollama node waits 75s
    // (infra/n8n/workflows/email-review.json) plus ~6.9s of Gmail fetch, so
    // this leaves ~8s. That margin is thin on purpose — it is what makes the
    // fallback reach the user instead of a 502 — so shrink the workflow's
    // requested output, never grow its timeout.
    timeoutMs: 90_000,
  },
];

/**
 * The n8n webhook must answer within this budget (FEAT-001 criterion) unless
 * the skill's own `timeoutMs` overrides it (FEAT-004).
 */
export const DEFAULT_SKILL_TIMEOUT_MS = 5_000;

export interface SkillDispatchSuccess {
  ok: true;
  /** The webhook's parsed JSON body, folded into `CommandResponse.skillResult`. */
  result: unknown;
}

export interface SkillDispatchFailure {
  ok: false;
  error: typeof SKILL_UNAVAILABLE;
}

export type SkillDispatchOutcome = SkillDispatchSuccess | SkillDispatchFailure;

export type SkillDispatcher = (
  intentName: string,
  request: SkillRequest,
) => Promise<SkillDispatchOutcome>;

export interface SkillDispatcherOptions {
  /** n8n webhook base URL, e.g. `http://localhost:5679/webhook`. */
  webhookBase: string;
  /** Registry to route against. Defaults to `SKILLS`. */
  skills?: readonly SkillDescriptor[];
  /** Injected for tests. Defaults to global `fetch`. */
  fetchFn?: typeof fetch;
  /**
   * Dispatcher-wide default timeout for skills without their own `timeoutMs`.
   * Defaults to `DEFAULT_SKILL_TIMEOUT_MS` (5s).
   */
  timeoutMs?: number;
  /** Where dispatch failures get logged. Defaults to `console.warn`. */
  warn?: (message: string) => void;
}

/** Join base and path tolerating stray slashes on either side. */
export function webhookUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

export function makeSkillDispatcher(options: SkillDispatcherOptions): SkillDispatcher {
  const skills = options.skills ?? SKILLS;
  const fetchFn = options.fetchFn ?? fetch;
  const defaultTimeoutMs = options.timeoutMs ?? DEFAULT_SKILL_TIMEOUT_MS;
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const byName = new Map(skills.map((skill) => [skill.name, skill]));

  const unavailable = (reason: string): SkillDispatchFailure => {
    warn(`skill dispatch: ${reason}`);
    return { ok: false, error: SKILL_UNAVAILABLE };
  };

  return async (intentName, request) => {
    const skill = byName.get(intentName);
    if (skill === undefined) {
      // Unreachable while the detector and this dispatcher share SKILLS, but
      // a misconfigured registry must degrade to 502, not crash.
      return unavailable(`no webhook registered for intent "${intentName}"`);
    }
    const url = webhookUrl(options.webhookBase, skill.webhookPath);
    // FEAT-004: a skill may carry its own budget (LLM-backed workflows need
    // more than 5s); anything unset or non-positive falls back to the default.
    const timeoutMs =
      skill.timeoutMs !== undefined && skill.timeoutMs > 0 ? skill.timeoutMs : defaultTimeoutMs;
    let response: Response;
    try {
      response = await fetchFn(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      return unavailable(
        `"${intentName}" webhook unreachable (down, or no answer within ${String(timeoutMs)}ms): ${String(err)}`,
      );
    }
    if (!response.ok) {
      return unavailable(`"${intentName}" webhook answered HTTP ${String(response.status)}`);
    }
    let result: unknown;
    try {
      result = await response.json();
    } catch (err) {
      // The skill contract is JSON; a 2xx with a garbage body is a broken
      // skill, not a result worth folding into the response.
      return unavailable(`"${intentName}" webhook answered 2xx but not JSON: ${String(err)}`);
    }
    return { ok: true, result };
  };
}

/**
 * Human reply for a successful dispatch: the skill's own `reply` field when
 * it provides a non-empty string (the ping workflow answers `"pong"`), else a
 * generic bilingual completion line. Not LLM-generated — stays literal, as
 * section 1 allows for skill replies.
 */
export function replyForSkillResult(intentName: string, result: unknown): string {
  const reply =
    typeof result === "object" && result !== null
      ? (result as { reply?: unknown }).reply
      : undefined;
  if (typeof reply === "string" && reply.trim() !== "") {
    return reply;
  }
  return `Skill "${intentName}" completed. / Skill "${intentName}" completado.`;
}

/** Static bilingual reply that accompanies the 502 `skill_unavailable` body. */
export function skillUnavailableReply(intentName: string): string {
  return (
    `Sorry, the "${intentName}" skill is unavailable right now. Please try again later. / ` +
    `Lo siento, el skill "${intentName}" no está disponible ahora mismo. Inténtalo de nuevo más tarde.`
  );
}
