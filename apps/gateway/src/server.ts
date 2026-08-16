/**
 * Entrypoint: config → intent handler → app → listen on 127.0.0.1:8787.
 * Run as `node --env-file=.env dist/server.js` (the `start` script).
 */
import { loadConfig } from "./config.js";
import { buildApp } from "./app.js";
import { makeIntentCommandHandler } from "./intent.js";
import { makeSkillDispatcher } from "./skills.js";

const config = loadConfig();
const app = buildApp({
  bearerToken: config.bearerToken,
  handleCommand: makeIntentCommandHandler({
    ollamaUrl: config.ollamaUrl,
    model: config.ollamaModel,
    dispatch: makeSkillDispatcher({ webhookBase: config.n8nWebhookBase }),
  }),
  logger: true,
});

try {
  await app.listen({ port: config.port, host: config.host });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
