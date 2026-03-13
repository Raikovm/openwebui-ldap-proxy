import type { BasicCredentials } from "./auth";
import type { SessionRecord } from "./types";

async function hashSecret(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Buffer.from(digest).toString("hex");
}

export class SessionStore {
  private ttlMs: number;
  private sessions = new Map<string, SessionRecord>();

  constructor(ttlSeconds: number) {
    this.ttlMs = ttlSeconds * 1000;
  }

  async buildKey(credentials: BasicCredentials): Promise<string> {
    const passwordHash = await hashSecret(credentials.password);
    return `${credentials.username}:${passwordHash}`;
  }

  async get(credentials: BasicCredentials): Promise<SessionRecord | null> {
    const key = await this.buildKey(credentials);
    const session = this.sessions.get(key);
    if (!session) {
      return null;
    }

    if (session.expiresAt <= Date.now()) {
      this.sessions.delete(key);
      return null;
    }

    return session;
  }

  async set(credentials: BasicCredentials, cookieHeader: string): Promise<SessionRecord> {
    const now = Date.now();
    const record: SessionRecord = {
      cookieHeader,
      createdAt: now,
      expiresAt: now + this.ttlMs,
    };

    const key = await this.buildKey(credentials);
    this.sessions.set(key, record);
    return record;
  }

  async delete(credentials: BasicCredentials): Promise<void> {
    const key = await this.buildKey(credentials);
    this.sessions.delete(key);
  }

  sweepExpired(): void {
    const now = Date.now();
    for (const [key, session] of this.sessions.entries()) {
      if (session.expiresAt <= now) {
        this.sessions.delete(key);
      }
    }
  }
}
