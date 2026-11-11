import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { publishDuePostsOnServer } from "./lib/publish-server";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

function isAuthorizedCronRequest(
  request: Request,
  envRecord?: Record<string, unknown>,
): boolean {
  const configuredSecret =
    (envRecord && typeof envRecord["CRON_SECRET"] === "string"
      ? envRecord["CRON_SECRET"].trim()
      : undefined) ||
    (typeof process !== "undefined" && process.env?.["CRON_SECRET"]
      ? process.env["CRON_SECRET"].trim()
      : undefined);

  if (!configuredSecret) return true;

  const authHeader = request.headers.get("authorization") ?? "";
  const cronHeader = request.headers.get("x-cron-secret") ?? "";
  return (
    authHeader === `Bearer ${configuredSecret}` || cronHeader === configuredSecret
  );
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/api/cron/publish-due") {
        const envRecord =
          env && typeof env === "object" ? (env as Record<string, unknown>) : undefined;

        if (!isAuthorizedCronRequest(request, envRecord)) {
          return new Response(
            JSON.stringify({ ok: false, error: "No autorizado (CRON_SECRET inválido)." }),
            {
              status: 401,
              headers: { "content-type": "application/json; charset=utf-8" },
            },
          );
        }

        const summary = await publishDuePostsOnServer(envRecord);
        return new Response(JSON.stringify(summary), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
        });
      }

      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },

  async scheduled(_controller: unknown, env: unknown, ctx: unknown) {
    const envRecord =
      env && typeof env === "object" ? (env as Record<string, unknown>) : undefined;
    const promise = publishDuePostsOnServer(envRecord);
    if (
      ctx &&
      typeof ctx === "object" &&
      "waitUntil" in ctx &&
      typeof (ctx as { waitUntil?: unknown }).waitUntil === "function"
    ) {
      (ctx as { waitUntil: (p: Promise<unknown>) => void }).waitUntil(promise);
      return;
    }
    await promise;
  },
};
