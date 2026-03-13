export type OpenAIContentPartText = {
  type: "text";
  text: string;
};

export type OpenAIContentPartImage = {
  type: "image_url";
  image_url: {
    url: string;
    detail?: string;
  };
};

export type OpenAIContentPart = OpenAIContentPartText | OpenAIContentPartImage | Record<string, unknown>;

export type OpenAIToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type OpenAIMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | OpenAIContentPart[] | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: OpenAIToolCall[];
};

export type OpenAIToolDefinition = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

export type OpenAIToolChoice = "none" | "auto" | "required" | {
  type: "function";
  function: {
    name: string;
  };
};

export type OpenAIChatCompletionRequest = {
  model: string;
  messages: OpenAIMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  top_p?: number;
  stop?: string | string[];
  user?: string;
  presence_penalty?: number;
  frequency_penalty?: number;
  n?: number;
  tools?: OpenAIToolDefinition[];
  tool_choice?: OpenAIToolChoice;
  response_format?: Record<string, unknown>;
  parallel_tool_calls?: boolean;
  [key: string]: unknown;
};

export type OpenAIUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

export type OpenAIChatCompletionResponse = {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: "assistant";
      content: string | null;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason: string | null;
  }>;
  usage?: OpenAIUsage;
};

export type SessionRecord = {
  cookieHeader: string;
  createdAt: number;
  expiresAt: number;
};

export type ProxyErrorOptions = {
  status: number;
  code: string;
  type?: string;
  details?: unknown;
};
