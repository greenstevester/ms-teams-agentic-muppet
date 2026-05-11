import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk';

interface Session {
  threadId: string;
  zone?: string;
  sdkSessionId?: string;
  workdir: string;
  mcpServers: Record<string, McpServerConfig>;
  allowedTools: string[];
  createdAt: number;
  lastUsedAt: number;
}

const sessions = new Map<string, Session>();

export async function getOrCreateSession(threadId: string): Promise<Session> {
  const existing = sessions.get(threadId);
  const now = Date.now();

  if (existing) {
    existing.lastUsedAt = now;
    return existing;
  }

  const safeId = threadId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const session: Session = {
    threadId,
    workdir: `/app/workspaces/${safeId}`,
    mcpServers: {},
    allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob'],
    createdAt: now,
    lastUsedAt: now,
  };
  sessions.set(threadId, session);
  return session;
}

export function setZoneForThread(threadId: string, zone: string): void {
  const existing = sessions.get(threadId);
  if (existing) existing.zone = zone;
}

// Periodic cleanup — drop sessions idle for 24h.
const ONE_DAY = 24 * 60 * 60 * 1000;
setInterval(() => {
  const cutoff = Date.now() - ONE_DAY;
  for (const [id, s] of sessions) {
    if (s.lastUsedAt < cutoff) sessions.delete(id);
  }
}, 60 * 60 * 1000).unref();
