import { config } from "./config";
import { ProxyError } from "./errors";
import { debugLog, redactSecret } from "./logger";

export type BasicCredentials = {
  username: string;
  password: string;
  authorizationHeader?: string;
};

function parseUsernamePassword(value: string): BasicCredentials {
  const separatorIndex = value.indexOf(":");
  if (separatorIndex === -1) {
    throw new ProxyError("Authorization credentials must contain username and password", {
      status: 401,
      code: "invalid_credentials_format",
      type: "authentication_error",
    });
  }

  const username = value.slice(0, separatorIndex);
  const password = value.slice(separatorIndex + 1);
  if (!username || !password) {
    throw new ProxyError("Username and password are required", {
      status: 401,
      code: "missing_credentials",
      type: "authentication_error",
    });
  }

  return { username, password };
}

function decodeBase64Token(token: string): string {
  let decoded = "";
  try {
    decoded = Buffer.from(token, "base64").toString("utf8");
  } catch {
    throw new ProxyError("Malformed Basic authorization header", {
      status: 401,
      code: "invalid_basic_auth",
      type: "authentication_error",
    });
  }
  return decoded;
}

function parseBearerToken(token: string): BasicCredentials {
  const trimmed = token.trim();
  if (!trimmed) {
    throw new ProxyError("Bearer token is empty", {
      status: 401,
      code: "missing_bearer_token",
      type: "authentication_error",
    });
  }

  if (trimmed.startsWith("basic:")) {
    return parseUsernamePassword(decodeBase64Token(trimmed.slice(6)));
  }

  if (trimmed.includes(":")) {
    return parseUsernamePassword(trimmed);
  }

  return parseUsernamePassword(decodeBase64Token(trimmed));
}

export async function requireBasicAuth(request: Request): Promise<BasicCredentials> {
  const requestHeader = request.headers.get("authorization")?.trim();
  const header = config.proxyAuthorization || requestHeader;
  if (!header) {
    throw new ProxyError("Authorization header is required", {
      status: 401,
      code: "authorization_required",
      type: "authentication_error",
    });
  }

  if (config.proxyAuthorization) {
    debugLog("using authorization from environment", {
      token_preview: redactSecret(header),
    });
  }

  if (header.startsWith("Basic ")) {
    debugLog("parsed authorization header", {
      scheme: "Basic",
      token_preview: redactSecret(header.slice(6)),
    });
    return {
      ...parseUsernamePassword(decodeBase64Token(header.slice(6))),
      authorizationHeader: header,
    };
  }

  if (header.startsWith("Bearer ")) {
    debugLog("parsed authorization header", {
      scheme: "Bearer",
      token_preview: redactSecret(header.slice(7)),
      bearer_mode: header.includes(":") ? "raw_or_prefixed" : "encoded_or_api_key",
    });
    return {
      ...parseBearerToken(header.slice(7)),
      authorizationHeader: header,
    };
  }

  throw new ProxyError("Expected Basic auth or Bearer credentials", {
    status: 401,
    code: "unsupported_auth_scheme",
    type: "authentication_error",
  });
}
