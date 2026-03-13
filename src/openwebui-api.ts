import { config } from "./config";
import { ProxyError } from "./errors";
import { debugLog, warnLog } from "./logger";
import type { BasicCredentials } from "./auth";
import { OpenWebUIAuthClient } from "./openwebui-auth";

type UpstreamRequestOptions = {
  path: string;
  method?: string;
  credentials: BasicCredentials;
  body?: string;
  contentType?: string;
  accept?: string;
};

function sanitizeErrorBody(body: string): string {
  return body.slice(0, 1000);
}

export class OpenWebUIApiClient {
  constructor(private readonly authClient: OpenWebUIAuthClient) {}

  async request(options: UpstreamRequestOptions): Promise<Response> {
    let cookieHeader = await this.authClient.getSessionCookie(options.credentials);
    debugLog("sending upstream request", {
      method: options.method || "GET",
      path: options.path,
      username: options.credentials.username,
      has_body: Boolean(options.body),
      accept: options.accept || "application/json",
    });
    let response = await this.doRequest(options, cookieHeader);

    if (response.status !== 401) {
      debugLog("upstream request completed", {
        method: options.method || "GET",
        path: options.path,
        status: response.status,
        username: options.credentials.username,
      });
      return response;
    }

    warnLog("upstream request returned 401, refreshing session", {
      method: options.method || "GET",
      path: options.path,
      username: options.credentials.username,
    });
    cookieHeader = await this.authClient.refresh(options.credentials);
    response = await this.doRequest(options, cookieHeader);
    debugLog("upstream request completed after refresh", {
      method: options.method || "GET",
      path: options.path,
      status: response.status,
      username: options.credentials.username,
    });
    return response;
  }

  async getJson<T>(options: UpstreamRequestOptions): Promise<T> {
    const response = await this.request(options);
    if (!response.ok) {
      throw await this.toProxyError(response);
    }
    return (await response.json()) as T;
  }

  private async doRequest(options: UpstreamRequestOptions, cookieHeader: string): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

    try {
      return await fetch(`${config.openWebUi.baseUrl}${options.path}`, {
        method: options.method || "GET",
        headers: {
          accept: options.accept || "application/json",
          ...(options.body ? { "content-type": options.contentType || "application/json" } : {}),
          cookie: cookieHeader,
        },
        body: options.body,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new ProxyError("Timed out while calling OpenWebUI", {
          status: 504,
          code: "upstream_timeout",
          type: "server_error",
        });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async toProxyError(response: Response): Promise<ProxyError> {
    const bodyText = sanitizeErrorBody(await response.text());
    warnLog("OpenWebUI request failed", {
      status: response.status,
      body_preview: bodyText.slice(0, 300),
    });

    if (response.status === 401) {
      return new ProxyError("Authentication to OpenWebUI failed after retry", {
        status: 401,
        code: "upstream_auth_failed",
        type: "authentication_error",
        details: { upstream_status: response.status, upstream_body: bodyText },
      });
    }

    if (response.status === 404) {
      return new ProxyError("Requested upstream endpoint was not found", {
        status: 502,
        code: "upstream_endpoint_not_found",
        type: "server_error",
        details: { upstream_status: response.status, upstream_body: bodyText },
      });
    }

    return new ProxyError("OpenWebUI request failed", {
      status: response.status >= 500 ? 502 : response.status,
      code: "upstream_request_failed",
      type: response.status >= 500 ? "server_error" : "invalid_request_error",
      details: { upstream_status: response.status, upstream_body: bodyText },
    });
  }
}
