import { requireBasicAuth } from "./auth";
import { config } from "./config";
import { jsonError, ProxyError } from "./errors";
import { debugLog, infoLog, warnLog } from "./logger";
import { toOpenAIChatResponse, toOpenAIModelsResponse, toUpstreamChatPayload } from "./mappers";
import { OpenWebUIApiClient } from "./openwebui-api";
import { OpenWebUIAuthClient } from "./openwebui-auth";
import { SessionStore } from "./session-store";
import { SseTransformer } from "./streaming";
import type { OpenAIChatCompletionRequest } from "./types";

const sessionStore = new SessionStore(config.sessionTtlSeconds);
const authClient = new OpenWebUIAuthClient(sessionStore);
const upstreamClient = new OpenWebUIApiClient(authClient);

setInterval(() => sessionStore.sweepExpired(), 60_000).unref?.();

function withRequestId(response: Response, requestId: string): Response {
  response.headers.set("x-request-id", requestId);
  return response;
}

async function handleModels(request: Request): Promise<Response> {
  const credentials = await requireBasicAuth(request);
  debugLog("handling models request", {
    username: credentials.username,
  });
  const upstream = await upstreamClient.getJson<Record<string, unknown> | Array<Record<string, unknown>>>({
    path: config.openWebUi.modelsPath,
    credentials,
  });
  return Response.json(toOpenAIModelsResponse(upstream));
}

async function handleChatCompletions(request: Request): Promise<Response> {
  const credentials = await requireBasicAuth(request);
  const body = (await request.json()) as OpenAIChatCompletionRequest;
  const upstreamPayload = toUpstreamChatPayload(body);

  debugLog("handling chat completion request", {
    username: credentials.username,
    model: body.model,
    stream: Boolean(body.stream),
    message_count: Array.isArray(body.messages) ? body.messages.length : 0,
    tool_count: Array.isArray(body.tools) ? body.tools.length : 0,
    has_tool_choice: body.tool_choice !== undefined,
  });

  const upstreamResponse = await upstreamClient.request({
    path: config.openWebUi.chatCompletionsPath,
    method: "POST",
    credentials,
    body: JSON.stringify(upstreamPayload),
    accept: body.stream ? "text/event-stream" : "application/json",
  });

  if (!upstreamResponse.ok) {
    const errorText = await upstreamResponse.text();
    warnLog("chat completion upstream failure", {
      username: credentials.username,
      model: body.model,
      status: upstreamResponse.status,
      body_preview: errorText.slice(0, 300),
    });
    throw new ProxyError("OpenWebUI chat completion request failed", {
      status: upstreamResponse.status >= 500 ? 502 : upstreamResponse.status,
      code: "upstream_chat_failed",
      type: upstreamResponse.status >= 500 ? "server_error" : "invalid_request_error",
      details: {
        upstream_status: upstreamResponse.status,
        upstream_body: errorText.slice(0, 1000),
      },
    });
  }

  if (body.stream) {
    if (!upstreamResponse.body) {
      throw new ProxyError("OpenWebUI returned an empty stream body", {
        status: 502,
        code: "empty_upstream_stream",
        type: "server_error",
      });
    }

    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    const model = body.model;
    const transformer = new SseTransformer();
    let sawDone = false;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const reader = upstreamResponse.body!.getReader();
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) {
              break;
            }

            const text = decoder.decode(value, { stream: true });
            const chunks = transformer.push(text, model);
            for (const chunk of chunks) {
              if (chunk === "data: [DONE]\n\n") {
                sawDone = true;
              }
              controller.enqueue(encoder.encode(chunk));
            }
          }
          const finalChunks = transformer.flushRemainder(model);
          for (const chunk of finalChunks) {
            if (chunk === "data: [DONE]\n\n") {
              sawDone = true;
            }
            controller.enqueue(encoder.encode(chunk));
          }
          if (!sawDone) {
            controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          }
          controller.close();
          debugLog("completed streaming chat response", {
            username: credentials.username,
            model,
            saw_done: sawDone,
          });
        } catch (error) {
          controller.error(error);
        } finally {
          reader.releaseLock();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  }

  const upstreamJson = (await upstreamResponse.json()) as Record<string, unknown>;
  return Response.json(toOpenAIChatResponse(upstreamJson, body.model));
}

async function router(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    return Response.json({ status: "ok" });
  }

  if (request.method === "GET" && url.pathname === "/v1/models") {
    return handleModels(request);
  }

  if (request.method === "POST" && url.pathname === "/v1/chat/completions") {
    return handleChatCompletions(request);
  }

  throw new ProxyError("Route not found", {
    status: 404,
    code: "route_not_found",
  });
}

Bun.serve({
  port: config.port,
  async fetch(request) {
    const requestId = crypto.randomUUID();
    const startedAt = Date.now();
    try {
      const response = await router(request);
      infoLog(`[${requestId}] ${request.method} ${new URL(request.url).pathname} -> ${response.status} ${Date.now() - startedAt}ms`);
      return withRequestId(response, requestId);
    } catch (error) {
      const response = jsonError(error, requestId);
      warnLog(`${request.method} ${new URL(request.url).pathname} failed`, {
        request_id: requestId,
        status: response.status,
        duration_ms: Date.now() - startedAt,
      });
      return withRequestId(response, requestId);
    }
  },
});

infoLog(`OpenWebUI OpenAI proxy listening on :${config.port}`);
