/**
 * Gateway configuration, read from the environment at boot.
 *
 * Port and host are settled by the spec (8787 on 127.0.0.1 — the Cloudflare
 * Tunnel is the only public entrance) and are deliberately not configurable.
 */

export interface GatewayConfig {
  readonly port: number;
  readonly host: string;
  readonly bearerToken: string;
  /** Ollama server base URL (`OLLAMA_URL`, default `http://localhost:11434`). */
  readonly ollamaUrl: string;
  /** Model used for intent detection (`OLLAMA_MODEL`, default `qwen2.5:7b`). */
  readonly ollamaModel: string;
  /**
   * n8n webhook base for skill dispatch
   * (`N8N_WEBHOOK_BASE`, default `http://localhost:5679/webhook`).
   */
  readonly n8nWebhookBase: string;
}

function envOrDefault(value: string | undefined, fallback: string): string {
  return value === undefined || value === "" ? fallback : value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): GatewayConfig {
  const bearerToken = env.GATEWAY_BEARER_TOKEN;
  if (bearerToken === undefined || bearerToken === "") {
    throw new Error("GATEWAY_BEARER_TOKEN is not set. Copy .env.example to .env and fill it in.");
  }
  return {
    port: 8787,
    host: "127.0.0.1",
    bearerToken,
    ollamaUrl: envOrDefault(env.OLLAMA_URL, "http://localhost:11434"),
    ollamaModel: envOrDefault(env.OLLAMA_MODEL, "qwen2.5:7b"),
    n8nWebhookBase: envOrDefault(env.N8N_WEBHOOK_BASE, "http://localhost:5679/webhook"),
  };
}
