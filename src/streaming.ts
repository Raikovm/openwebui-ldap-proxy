import type { OpenAIToolCall } from "./types";

type UpstreamChoice = {
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
};

type UpstreamEvent = {
  id?: string;
  model?: string;
  created?: number;
  choices?: UpstreamChoice[];
};

function toOpenAIChunk(event: UpstreamEvent, fallbackModel: string): string {
  const choice = event.choices?.[0];
  const toolCalls = choice?.delta?.tool_calls?.map((toolCall, index) => ({
    index: toolCall.index ?? index,
    id: toolCall.id,
    type: toolCall.type ?? "function",
    function: {
      ...(toolCall.function?.name ? { name: toolCall.function.name } : {}),
      ...(toolCall.function?.arguments ? { arguments: toolCall.function.arguments } : {}),
    },
  }));

  const chunk = {
    id: event.id || crypto.randomUUID(),
    object: "chat.completion.chunk",
    created: event.created || Math.floor(Date.now() / 1000),
    model: event.model || fallbackModel,
    choices: [
      {
        index: choice?.index || 0,
        delta: {
          ...(choice?.delta?.role ? { role: choice.delta.role } : {}),
          ...(choice?.delta?.content ? { content: choice.delta.content } : {}),
          ...(toolCalls && toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: choice?.finish_reason || null,
      },
    ],
  };

  return `data: ${JSON.stringify(chunk)}\n\n`;
}

export class SseTransformer {
  private buffer = "";

  private nextBoundaryIndex(): number {
    const lfBoundary = this.buffer.indexOf("\n\n");
    const crlfBoundary = this.buffer.indexOf("\r\n\r\n");

    if (lfBoundary === -1) {
      return crlfBoundary;
    }

    if (crlfBoundary === -1) {
      return lfBoundary;
    }

    return Math.min(lfBoundary, crlfBoundary);
  }

  push(chunk: string, fallbackModel: string): string[] {
    this.buffer += chunk;
    const outputs: string[] = [];

    while (true) {
      const boundaryIndex = this.nextBoundaryIndex();
      if (boundaryIndex === -1) {
        break;
      }

      const rawEvent = this.buffer.slice(0, boundaryIndex);
      const separatorLength = this.buffer.startsWith("\r\n\r\n", boundaryIndex) ? 4 : 2;
      this.buffer = this.buffer.slice(boundaryIndex + separatorLength);

      const payload = rawEvent
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");

      if (!payload) {
        continue;
      }

      if (payload === "[DONE]") {
        outputs.push("data: [DONE]\n\n");
        continue;
      }

      try {
        const parsed = JSON.parse(payload) as UpstreamEvent;
        outputs.push(toOpenAIChunk(parsed, fallbackModel));
      } catch {
        outputs.push(`data: ${payload}\n\n`);
      }
    }

    return outputs;
  }

  flushRemainder(fallbackModel: string): string[] {
    if (!this.buffer.trim()) {
      return [];
    }

    const remainder = this.buffer;
    this.buffer = "";
    return this.push(`${remainder}\n\n`, fallbackModel);
  }
}
