import { config } from "./config";

function isDebugEnabled(): boolean {
  return config.logLevel === "debug";
}

export function redactSecret(value: string, visible = 2): string {
  if (!value) {
    return "<empty>";
  }

  if (value.length <= visible * 2) {
    return `${value.slice(0, 1)}***${value.slice(-1)}`;
  }

  return `${value.slice(0, visible)}***${value.slice(-visible)}`;
}

export function debugLog(message: string, details?: Record<string, unknown>): void {
  if (!isDebugEnabled()) {
    return;
  }

  if (details) {
    console.debug(`[debug] ${message}`, details);
    return;
  }

  console.debug(`[debug] ${message}`);
}

export function infoLog(message: string): void {
  if (config.logLevel === "debug" || config.logLevel === "info") {
    console.log(message);
  }
}

export function warnLog(message: string, details?: Record<string, unknown>): void {
  if (details) {
    console.warn(`[warn] ${message}`, details);
    return;
  }

  console.warn(`[warn] ${message}`);
}
