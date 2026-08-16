/**
 * Shared contracts between the gateway and its clients.
 *
 * These types are the wire format of the gateway's `/command` endpoint.
 * They grow per slice (see docs/features/FEAT-001-gateway-command-endpoint.md):
 * slice 2 adds the intent-detection contract, slice 3 the skill registry.
 */

/** Body of `POST /command`. */
export interface CommandRequest {
  /** The plain-text command, e.g. "ping" or "enciende la luz". */
  text: string;
}

/**
 * What intent detection makes of a piece of text (slice 2).
 *
 * Produced by the gateway's Ollama classifier; consumed by skill dispatch
 * (slice 3). `intent` is either one of the registered intent names or the
 * literal `"unknown"` — any model output that fails to parse or names an
 * unregistered intent collapses to `"unknown"`, never an error.
 */
export interface IntentDetection {
  /** A registered intent name, or `"unknown"`. */
  intent: string;
  /** Parameters the model extracted from the text; empty object when none. */
  params: Record<string, unknown>;
}

/**
 * One entry in the gateway's skill registry (slice 3): an intent the
 * classifier can recognize and the n8n webhook that serves it.
 */
export interface SkillDescriptor {
  /** Intent name the classifier can answer, e.g. `"ping"`. */
  readonly name: string;
  /** One line, shown to the classifier and (via the LLM) to the user. */
  readonly description: string;
  /**
   * Path under the n8n webhook base, e.g. `"ping"` means the gateway calls
   * `POST {N8N_WEBHOOK_BASE}/ping`.
   */
  readonly webhookPath: string;
  /**
   * Per-skill override of the dispatcher's default timeout; omit to use
   * `DEFAULT_SKILL_TIMEOUT_MS`. LLM-backed skills whose n8n workflow calls
   * Ollama need more than the 5s default (FEAT-004).
   */
  readonly timeoutMs?: number;
}

/** Body the gateway POSTs to a skill's n8n webhook. */
export interface SkillRequest {
  /** The user's original plain-text command. */
  text: string;
  /** Parameters the intent classifier extracted; empty object when none. */
  params: Record<string, unknown>;
}

/**
 * Body the n8n `agenda` workflow answers (FEAT-002): today's events from the
 * primary Google Calendar as a time-ordered rundown. The gateway folds it
 * verbatim into `CommandResponse.skillResult` and surfaces `reply` as the
 * command's reply (`replyForSkillResult`).
 */
export interface AgendaSkillResult {
  ok: boolean;
  /**
   * The rundown text: LLM-summarized by the workflow's Ollama step (≤ ~120
   * words, language-mirrored — FEAT-002 slice 2), falling back to the
   * deterministic time-ordered list from slice 1 when Ollama is unreachable
   * or answers something unusable. A day with no events still answers
   * `ok: true` with a pleasant line here.
   */
  reply: string;
  /** How many events today's primary calendar returned. */
  eventCount: number;
  /** The day covered, `YYYY-MM-DD` in the n8n instance's timezone. */
  date: string;
  /**
   * `true` when `reply` came from the Ollama summarization step; `false`
   * when the workflow fell back to the deterministic rundown (slice 2).
   * Absent from pre-slice-2 payloads.
   */
  summarized?: boolean;
}

/**
 * Body the n8n `email-review` workflow answers (FEAT-003): unread Gmail
 * messages from the last 24 hours (capped at 25) as a chronological
 * sender+subject list. The gateway folds it verbatim into
 * `CommandResponse.skillResult` and surfaces `reply` as the command's reply
 * (`replyForSkillResult`).
 */
export interface EmailReviewSkillResult {
  ok: boolean;
  /**
   * The unread-mail review: LLM-prioritized by the workflow's Ollama step
   * (action-needed items first, then FYIs; sender + gist per item; repetitive
   * senders/newsletters grouped; language-mirrored — FEAT-003 slice 2),
   * falling back to the deterministic chronological
   * `- HH:mm: sender — subject` list from slice 1 when Ollama is unreachable
   * or answers something unusable. Nothing unread still answers `ok: true`
   * with a pleasant line here. Privacy (FEAT-003 dossier rule): only sender
   * and subject feed this text — never message bodies or snippets.
   */
  reply: string;
  /** How many unread messages (last 24h) the workflow pulled — at most 25. */
  messageCount: number;
  /** `true` when the 25-message cap was hit: there may be more unread mail. */
  capReached: boolean;
  /**
   * `true` when `reply` came from the Ollama prioritization step; `false`
   * when the workflow fell back to the deterministic list (slice 2). Absent
   * from pre-slice-2 payloads.
   */
  summarized?: boolean;
}

/**
 * `CommandResponse.error` code (with HTTP 502) when a skill's webhook is
 * down, answers non-2xx, or doesn't answer within the dispatch timeout.
 */
export const SKILL_UNAVAILABLE = "skill_unavailable";

/**
 * Body of a `POST /command` response.
 *
 * `ok` is `false` only for skill-dispatch failures (slice 3), which also
 * carry an `error` code; an unrecognized intent still answers `ok: true`
 * with `intent: "unknown"`.
 */
export interface CommandResponse {
  ok: boolean;
  /** Detected intent name, or `"unknown"` when nothing matched. */
  intent: string;
  /** Human-readable answer, mirroring the input language when LLM-generated. */
  reply: string;
  /** Raw result from the dispatched skill (slice 3), when there is one. */
  skillResult?: unknown;
  /** Machine-readable error code, present only when `ok` is `false`. */
  error?: string;
}
