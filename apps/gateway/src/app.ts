/**
 * Fastify app factory.
 *
 * The command handler is injected so slices 2–3 can plug in real intent
 * detection and skill dispatch without touching the routes, and so tests can
 * fake it and exercise everything through `app.inject` (no sockets).
 */
import Fastify, { type FastifyInstance } from "fastify";
import type { CommandRequest, CommandResponse } from "@xavi/shared";
import { makeBearerAuthHook } from "./auth.js";

export type CommandHandler = (text: string) => Promise<CommandResponse>;

export interface BuildAppOptions {
  bearerToken: string;
  /**
   * Required since slice 2: production wires `makeIntentCommandHandler`
   * (see `server.ts`); tests inject fakes. The slice-1 echo default is gone
   * on purpose — a silently-echoing production gateway would be a bug.
   */
  handleCommand: CommandHandler;
  logger?: boolean;
}

const commandBodySchema = {
  type: "object",
  required: ["text"],
  properties: {
    text: { type: "string", minLength: 1 },
  },
} as const;

export function buildApp(options: BuildAppOptions): FastifyInstance {
  const { bearerToken, handleCommand, logger = false } = options;
  // coerceTypes off: Ajv's default coercion would turn {text: 42} into "42"
  // and defeat the "non-string text → 400" criterion.
  const app = Fastify({ logger, ajv: { customOptions: { coerceTypes: false } } });

  app.get("/healthz", async () => ({ status: "ok" }));

  app.post<{ Body: CommandRequest }>(
    "/command",
    {
      onRequest: makeBearerAuthHook(bearerToken),
      schema: { body: commandBodySchema },
    },
    async (request, reply): Promise<CommandResponse> => {
      const response = await handleCommand(request.body.text);
      if (!response.ok) {
        // Per the shared contract, ok:false means a skill dispatch failed
        // (`error: "skill_unavailable"`) → 502 Bad Gateway.
        void reply.code(502);
      }
      return response;
    },
  );

  return app;
}
