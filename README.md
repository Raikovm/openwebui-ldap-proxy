# OpenWebUI OpenAI Proxy

Small Bun/TypeScript proxy that authenticates against OpenWebUI with login/password and exposes an OpenAI-compatible API for `GET /v1/models` and `POST /v1/chat/completions`.

The current default target is LDAP-backed OpenWebUI, so the proxy logs in through `POST /api/v1/auths/ldap` and forwards authenticated requests to the OpenWebUI REST API.

## What it does

- Accepts `Authorization: Basic <base64(username:password)>`
- Accepts `Authorization: Bearer <token>` where the token can be `username:password`, `base64(username:password)`, or `basic:<base64(username:password)>`
- Logs into OpenWebUI and stores upstream session cookies in memory
- Reuses the upstream session until it expires
- Retries once by re-authenticating if OpenWebUI returns `401`
- Exposes OpenAI-like response formats for models and chat completions
- Preserves tool-calling fields for agentic clients like OpenCode
- Translates upstream SSE streams into OpenAI-style SSE chunks
- Tolerates unknown top-level request fields so OpenAI-compatible SDKs can pass provider options

## Endpoints

- `GET /health`
- `GET /v1/models`
- `POST /v1/chat/completions`

## Quick start

1. Install dependencies:

```bash
bun install
```

2. Copy env file and adjust it for your OpenWebUI instance:

```bash
cp .env.example .env
```

3. Start the proxy:

```bash
bun run dev
```

## Configuration

Important variables:

- `OPENWEBUI_BASE_URL`: OpenWebUI base URL
- `OPENWEBUI_LOGIN_PATH`: login API path
- `OPENWEBUI_LOGIN_USERNAME_FIELD`: login identifier field name
- `OPENWEBUI_LOGIN_PASSWORD_FIELD`: password field name
- `OPENWEBUI_MODELS_PATH`: upstream models path
- `OPENWEBUI_CHAT_COMPLETIONS_PATH`: upstream chat completions path
- `OPENWEBUI_LOGIN_EXTRA_JSON`: optional JSON object merged into login payload
- `OPENWEBUI_CHAT_EXTRA_JSON`: optional JSON object merged into chat payload

Default LDAP-oriented config from `.env.example`:

```env
OPENWEBUI_LOGIN_PATH=/api/v1/auths/ldap
OPENWEBUI_LOGIN_USERNAME_FIELD=user
OPENWEBUI_LOGIN_PASSWORD_FIELD=password
```

That produces a login payload like:

```json
{
  "user": "your-ldap-login",
  "password": "your-password"
}
```

If your OpenWebUI instance uses the regular password signin endpoint instead of LDAP, switch to:

```env
OPENWEBUI_LOGIN_PATH=/api/v1/auths/signin
OPENWEBUI_LOGIN_USERNAME_FIELD=email
OPENWEBUI_LOGIN_PASSWORD_FIELD=password
```

Important:

- `OPENWEBUI_LOGIN_USERNAME_FIELD` and `OPENWEBUI_LOGIN_PASSWORD_FIELD` are field names, not secrets
- do not put your actual username or password into those variables
- your actual credentials must come from the incoming request auth header

## Example request

Using Basic auth:

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Basic $(printf '%s' 'username:password' | base64)" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "your-model-id",
    "messages": [
      {"role": "user", "content": "Hello"}
    ]
  }'
```

Using Bearer auth:

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Authorization: Bearer username:password" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "your-model-id",
    "messages": [
      {"role": "user", "content": "Hello"}
    ]
  }'
```

## OpenCode setup

Example OpenCode provider config is available at `examples/opencode.jsonc`.

OpenCode's OpenAI-compatible provider manages the `Authorization` header itself, so the correct integration path is to pass credentials through `options.apiKey`.

1. Export the proxy bearer value:

```bash
export OPENWEBUI_PROXY_BEARER='your-ldap-login:your-password'
```

If you prefer, you can also use base64:

```bash
export OPENWEBUI_PROXY_BEARER="$(printf '%s' 'your-ldap-login:your-password' | base64 | tr -d '\n')"
```

2. Copy `examples/opencode.jsonc` into one of these places:

- `~/.config/opencode/opencode.json`
- `opencode.json` in your project root

3. Replace `your-model-id` in the config with a real model ID returned by `GET /v1/models`

Minimal example:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "openwebui-proxy": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "OpenWebUI Proxy",
      "options": {
        "baseURL": "http://127.0.0.1:3000/v1",
        "apiKey": "{env:OPENWEBUI_PROXY_BEARER}"
      },
      "models": {
        "your-model-id": {
          "name": "OpenWebUI Model"
        }
      }
    }
  },
  "model": "openwebui-proxy/your-model-id",
  "small_model": "openwebui-proxy/your-model-id"
}
```

## OpenCode compatibility

The proxy is designed primarily for OpenCode's OpenAI-compatible `chat/completions` flow.

Supported today:

- `GET /v1/models`
- `POST /v1/chat/completions`
- non-streaming and streaming responses
- tool definitions and tool-call history passthrough
- assistant tool-call responses in OpenAI-like shape

Not implemented:

- `/v1/responses`
- OpenAI Assistants API
- file upload APIs
- persistent proxy-issued tokens

## Debugging auth failures

Set `LOG_LEVEL=debug` in `.env` and restart the proxy.

The proxy will then log:

- incoming auth scheme parsing
- login path and field names used for OpenWebUI auth
- whether a cached session was reused
- OpenWebUI login response status
- whether session cookies were returned
- whether the failure happened during login or during the authenticated chat request

Sensitive values are redacted in debug logs.

## Notes

- Sessions are stored in memory only in this version
- The proxy never returns OpenWebUI session cookies to the client
- Final tool-calling behavior still depends on the upstream OpenWebUI model/provider supporting tools
- Multimodal content parts are forwarded in array form when present instead of being flattened to plain text
