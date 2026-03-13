type JsonRecord = Record<string, unknown>;

function validateFieldName(name: string, value: string): string {
  if (!value.trim()) {
    throw new Error(`Environment variable ${name} cannot be empty`);
  }

  if (value.includes(":")) {
    throw new Error(
      `Environment variable ${name} looks like a credential value, but it must be a request field name such as 'email' or 'password'`,
    );
  }

  if (/\s/.test(value)) {
    throw new Error(`Environment variable ${name} must not contain whitespace`);
  }

  if (/["'`]/.test(value)) {
    throw new Error(`Environment variable ${name} must be a plain field name, not a quoted secret value`);
  }

  return value;
}

function readRequired(name: string): string {
  const value = Bun.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function readNumber(name: string, fallback: number): number {
  const raw = Bun.env[name]?.trim();
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Environment variable ${name} must be a finite number`);
  }
  return parsed;
}

function readJsonObject(name: string): JsonRecord {
  const raw = Bun.env[name]?.trim();
  if (!raw) {
    return {};
  }

  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new Error(`Environment variable ${name} must be a JSON object`);
  }
  return parsed as JsonRecord;
}

function normalizePath(path: string): string {
  return path.startsWith("/") ? path : `/${path}`;
}

function defaultLoginUsernameField(loginPath: string): string {
  return loginPath.endsWith("/ldap") ? "user" : "email";
}

function defaultLoginPasswordField(): string {
  return "password";
}

const loginPath = normalizePath(Bun.env.OPENWEBUI_LOGIN_PATH?.trim() || "/api/v1/auths/ldap");

export const config = {
  port: readNumber("PORT", 3000),
  logLevel: Bun.env.LOG_LEVEL?.trim() || "info",
  requestTimeoutMs: readNumber("REQUEST_TIMEOUT_MS", 60_000),
  sessionTtlSeconds: readNumber("SESSION_TTL_SECONDS", 3600),
  openWebUi: {
    baseUrl: readRequired("OPENWEBUI_BASE_URL").replace(/\/$/, ""),
    loginPath,
    loginUsernameField: validateFieldName(
      "OPENWEBUI_LOGIN_USERNAME_FIELD",
      Bun.env.OPENWEBUI_LOGIN_USERNAME_FIELD?.trim() || defaultLoginUsernameField(loginPath),
    ),
    loginPasswordField: validateFieldName(
      "OPENWEBUI_LOGIN_PASSWORD_FIELD",
      Bun.env.OPENWEBUI_LOGIN_PASSWORD_FIELD?.trim() || defaultLoginPasswordField(),
    ),
    modelsPath: normalizePath(Bun.env.OPENWEBUI_MODELS_PATH?.trim() || "/api/models"),
    chatCompletionsPath: normalizePath(
      Bun.env.OPENWEBUI_CHAT_COMPLETIONS_PATH?.trim() || "/api/chat/completions",
    ),
    loginExtraJson: readJsonObject("OPENWEBUI_LOGIN_EXTRA_JSON"),
    chatExtraJson: readJsonObject("OPENWEBUI_CHAT_EXTRA_JSON"),
  },
} as const;
