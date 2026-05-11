import { readFile } from 'fs/promises';
import { join } from 'path';

const CONTEXT_ROOT = process.env.CONTEXT_REPO ?? '/app/context';
const ZONES_DIR = process.env.ZONES_DIR ?? '/app/zones';

interface LoadContextOpts {
  zone?: string;
  channelId: string;
  userId: string;
}

interface LoadedContext {
  zone: string | null;
  channel: string | null;
  user: string | null;
}

export async function loadContext(opts: LoadContextOpts): Promise<LoadedContext> {
  const safeChannel = sanitize(opts.channelId);
  const safeUser = sanitize(opts.userId);

  return {
    zone: opts.zone
      ? await tryRead(join(ZONES_DIR, sanitize(opts.zone), 'SKILL.md'))
      : null,
    channel: await tryRead(
      join(CONTEXT_ROOT, 'channels', safeChannel, 'memory.qmd'),
    ),
    user: await tryRead(join(CONTEXT_ROOT, 'users', safeUser, 'memory.qmd')),
  };
}

async function tryRead(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8');
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

function sanitize(id: string): string {
  // Teams conversation IDs contain colons, slashes, semicolons.
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}
