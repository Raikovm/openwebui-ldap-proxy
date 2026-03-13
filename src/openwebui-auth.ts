import { config } from "./config";
import { ProxyError } from "./errors";
import { debugLog, redactSecret, warnLog } from "./logger";
import type { BasicCredentials } from "./auth";
import { SessionStore } from "./session-store";

function extractSetCookie(headers: Headers): string[] {
  const getter = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof getter === "function") {
    return getter.call(headers);
  }

  const combined = headers.get("set-cookie");
  if (!combined) {
    return [];
  }

  return combined.split(/,(?=\s*[^;=]+=)/g);
}

function toCookieHeader(setCookies: string[]): string {
  return setCookies
    .map((entry) => entry.split(";", 1)[0]?.trim())
    .filter((entry): entry is string => Boolean(entry))
    .join("; ");
}

export class OpenWebUIAuthClient {
  constructor(private readonly store: SessionStore) {}

  async getSessionCookie(credentials: BasicCredentials): Promise<string> {
    const existing = await this.store.get(credentials);
    if (existing) {
      debugLog("reusing cached OpenWebUI session", {
        username: credentials.username,
        expires_at: new Date(existing.expiresAt).toISOString(),
      });
      return existing.cookieHeader;
    }

    debugLog("no cached OpenWebUI session found", {
      username: credentials.username,
    });
    return this.login(credentials);
  }

  async invalidate(credentials: BasicCredentials): Promise<void> {
    await this.store.delete(credentials);
  }

  async refresh(credentials: BasicCredentials): Promise<string> {
    await this.invalidate(credentials);
    return this.login(credentials);
  }

  private async login(credentials: BasicCredentials): Promise<string> {
    const payload: Record<string, unknown> = {
      ...config.openWebUi.loginExtraJson,
      [config.openWebUi.loginUsernameField]: credentials.username,
      [config.openWebUi.loginPasswordField]: credentials.password,
    };

    debugLog("attempting OpenWebUI login", {
      base_url: config.openWebUi.baseUrl,
      login_path: config.openWebUi.loginPath,
      username_field: config.openWebUi.loginUsernameField,
      password_field: config.openWebUi.loginPasswordField,
      username: credentials.username,
      payload_keys: Object.keys(payload),
      login_extra_keys: Object.keys(config.openWebUi.loginExtraJson),
    });

    const response = await fetch(`${config.openWebUi.baseUrl}${config.openWebUi.loginPath}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    debugLog("OpenWebUI login response received", {
      username: credentials.username,
      status: response.status,
      content_type: response.headers.get("content-type") || "",
      set_cookie_count: extractSetCookie(response.headers).length,
    });

    if (!response.ok) {
      const bodyText = await response.text();
      warnLog("OpenWebUI login failed", {
        username: credentials.username,
        status: response.status,
        body_preview: bodyText.slice(0, 300),
      });
      throw new ProxyError("Authentication to OpenWebUI failed", {
        status: 401,
        code: "upstream_auth_failed",
        type: "authentication_error",
        details: {
          upstream_status: response.status,
          upstream_body: bodyText.slice(0, 500),
        },
      });
    }

    const cookieHeader = toCookieHeader(extractSetCookie(response.headers));
    if (!cookieHeader) {
      warnLog("OpenWebUI login returned no cookies", {
        username: credentials.username,
        status: response.status,
      });
      throw new ProxyError("OpenWebUI login succeeded but no session cookies were returned", {
        status: 502,
        code: "missing_upstream_session_cookie",
        type: "server_error",
      });
    }

    debugLog("stored OpenWebUI session cookies", {
      username: credentials.username,
      cookie_preview: redactSecret(cookieHeader, 6),
      cookie_count: cookieHeader.split(";").filter(Boolean).length,
    });

    await this.store.set(credentials, cookieHeader);
    return cookieHeader;
  }
}
