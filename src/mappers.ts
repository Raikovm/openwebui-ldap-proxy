import { config } from "./config";
import { ProxyError } from "./errors";
import type {
  OpenAIContentPart,
  OpenAIChatCompletionRequest,
  OpenAIChatCompletionResponse,
  OpenAIMessage,
  OpenAIToolCall,
} from "./types";

type UpstreamChatResponse = {
  id?: string;
  model?: string;
  created?: number;
  choices?: Array<{
    index?: number;
    finish_reason?: string | null;
    message?: {
      role?: string;
      content?: string | null;
      tool_calls?: OpenAIToolCall[];
    };
    delta?: {
      role?: string;
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        type?: "function";
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
    tool_calls?: OpenAIToolCall[];
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
};

type UpstreamModelsResponse =
  | { data?: Array<Record<string, unknown>> }
  | Array<Record<string, unknown>>;

function normalizeContentPart(part: OpenAIContentPart): Record<string, unknown> {
  if (typeof (part as { type?: unknown }).type === "string") {
    return part as Record<string, unknown>;
  }

  if (typeof (part as { text?: unknown }).text === "string") {
    return {
      type: "text",
      text: (part as { text: string }).text,
    };
  }

  return part as Record<string, unknown>;
}

function normalizeMessageContent(content: OpenAIMessage["content"]): string | Record<string, unknown>[] | null | undefined {
  if (content === undefined || content === null || typeof content === "string") {
    return content;
  }

  return content.map((part) => normalizeContentPart(part));
}

function normalizeMessage(message: OpenAIMessage): Record<string, unknown> {
  return {
    role: message.role,
    ...(message.name ? { name: message.name } : {}),
    ...(message.tool_call_id ? { tool_call_id: message.tool_call_id } : {}),
    ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}),
    ...(message.content !== undefined ? { content: normalizeMessageContent(message.content) } : {}),
  };
}

function pickAllowedExtraFields(body: OpenAIChatCompletionRequest): Record<string, unknown> {
  const knownKeys = new Set([
    "model",
    "messages",
    "stream",
    "temperature",
    "max_tokens",
    "max_completion_tokens",
    "top_p",
    "stop",
    "user",
    "presence_penalty",
    "frequency_penalty",
    "n",
    "tools",
    "tool_choice",
    "response_format",
    "parallel_tool_calls",
  ]);

  return Object.fromEntries(Object.entries(body).filter(([key]) => !knownKeys.has(key)));
}

export function toUpstreamChatPayload(body: OpenAIChatCompletionRequest): Record<string, unknown> {
  if (!body.model) {
    throw new ProxyError("Field 'model' is required", {
      status: 400,
      code: "missing_model",
    });
  }

  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new ProxyError("Field 'messages' must be a non-empty array", {
      status: 400,
      code: "missing_messages",
    });
  }

  if (body.n !== undefined && body.n !== 1) {
    throw new ProxyError("Only n=1 is currently supported", {
      status: 400,
      code: "unsupported_parameter",
      details: { parameter: "n" },
    });
  }

  return {
    ...config.openWebUi.chatExtraJson,
    ...pickAllowedExtraFields(body),
    model: body.model,
    messages: body.messages.map(normalizeMessage),
    stream: Boolean(body.stream),
    temperature: body.temperature,
    max_tokens: body.max_tokens ?? body.max_completion_tokens,
    top_p: body.top_p,
    stop: body.stop,
    user: body.user,
    presence_penalty: body.presence_penalty,
    frequency_penalty: body.frequency_penalty,
    tools: body.tools,
    tool_choice: body.tool_choice,
    response_format: body.response_format,
    parallel_tool_calls: body.parallel_tool_calls,
  };
}

export function toOpenAIModelsResponse(upstream: UpstreamModelsResponse): { object: string; data: Array<Record<string, unknown>> } {
  const rawItems = Array.isArray(upstream) ? upstream : upstream.data || [];
  const data = rawItems.map((item) => {
    const id = typeof item.id === "string" ? item.id : typeof item.name === "string" ? item.name : "unknown-model";
    return {
      id,
      object: "model",
      created: 0,
      owned_by: "openwebui",
      ...item,
    };
  });

  return {
    object: "list",
    data,
  };
}

export function toOpenAIChatResponse(
  upstream: UpstreamChatResponse,
  fallbackModel: string,
): OpenAIChatCompletionResponse {
  const firstChoice = upstream.choices?.[0];
  const toolCalls = firstChoice?.message?.tool_calls || firstChoice?.tool_calls;
  const content = firstChoice?.message?.content ?? firstChoice?.delta?.content ?? null;

  return {
    id: upstream.id || crypto.randomUUID(),
    object: "chat.completion",
    created: upstream.created || Math.floor(Date.now() / 1000),
    model: upstream.model || fallbackModel,
    choices: [
      {
        index: firstChoice?.index || 0,
        message: {
          role: "assistant",
          content,
          ...(toolCalls && toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: firstChoice?.finish_reason || (toolCalls?.length ? "tool_calls" : "stop"),
      },
    ],
    ...(upstream.usage
      ? {
          usage: {
            prompt_tokens: upstream.usage.prompt_tokens || 0,
            completion_tokens: upstream.usage.completion_tokens || 0,
            total_tokens: upstream.usage.total_tokens || 0,
          },
        }
      : {}),
  };
}
