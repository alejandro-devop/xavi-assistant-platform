/**
 * Static bearer-token auth for every route except /healthz.
 *
 * Registered as an `onRequest` hook (not `preHandler`) so authentication is
 * decided before body parsing and schema validation: an unauthenticated
 * request always gets 401, never a validation 400 first.
 *
 * The 401 body is deliberately generic — it must leak nothing about why the
 * check failed or what a correct token looks like.
 */
import { timingSafeEqual } from "node:crypto";
import type { onRequestHookHandler } from "fastify";

const UNAUTHORIZED_BODY = { error: "unauthorized" } as const;

function tokenMatches(candidate: string, expected: string): boolean {
  const candidateBuf = Buffer.from(candidate);
  const expectedBuf = Buffer.from(expected);
  if (candidateBuf.length !== expectedBuf.length) {
    return false;
  }
  return timingSafeEqual(candidateBuf, expectedBuf);
}

export function makeBearerAuthHook(bearerToken: string): onRequestHookHandler {
  return function bearerAuthHook(request, reply, done) {
    const header = request.headers.authorization;
    const prefix = "Bearer ";
    if (
      header === undefined ||
      !header.startsWith(prefix) ||
      !tokenMatches(header.slice(prefix.length), bearerToken)
    ) {
      void reply.code(401).send(UNAUTHORIZED_BODY);
      done();
      return;
    }
    done();
  };
}
