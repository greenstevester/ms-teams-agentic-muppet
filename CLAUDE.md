# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build     # tsc → dist/
npm run lint      # tsc --noEmit (this repo's "lint" is a type-check; there is no ESLint)
npm run dev       # tsc --watch + nodemon on dist/
npm start         # node dist/index.js (expects build first)

docker compose up --build              # full local stack (hermes + litellm)
docker compose --profile tunnel up     # adds cloudflared for real-Teams testing
```

There is **no test runner configured**. Don't claim tests pass — there are none to run. If you add tests, add the runner and a `test` script in the same change.

## Architecture

Hermes is a Microsoft Teams bot that hands every channel message off to a Claude Agent SDK session. Request flow:

1. **`src/index.ts`** — Express server on `:3978`. Hosts the Bot Framework `CloudAdapter` and exposes `/api/messages` (Bot Framework webhook) and `/healthz`. Also **exports `adapter`** because `agent.ts` re-imports it to post back asynchronously (`continueConversationAsync`). That circular import is load-bearing.
2. **`src/bot.ts`** — `HermesBot` extends `ActivityHandler`. Enforces the **public-only gate**: `conversationType === 'personal'` and `'groupChat'` are rejected with a canned refusal. Only `channel` activity proceeds. After mention-stripping, it fires `runAgentTurn` **fire-and-forget** and immediately sends a `typing` activity so Teams doesn't time out.
3. **`src/agent.ts`** — Builds a system prompt by concatenating zone + channel + user context, then drives the Claude Agent SDK `query()` async iterator. Accumulates `assistant`/`text` blocks into `finalText`, captures `session_id` from the `result` message, and posts the reply back via `adapter.continueConversationAsync` using the captured `ConversationReference`.
4. **`src/context.ts`** — Reads three files at turn time: `zones/<zone>/SKILL.md`, `context/channels/<sanitized id>/memory.qmd`, `context/users/<sanitized aadObjectId>/memory.qmd`. All optional — missing files are `null`, not errors. `sanitize()` strips everything outside `[a-zA-Z0-9_-]` because Teams IDs contain `:` `/` `;`.
5. **`src/sessions.ts`** — In-memory `Map<threadId, Session>`. Holds the SDK `session_id` for pause/resume across Teams turns, the per-thread `workdir` (`/app/workspaces/<sanitizedThreadId>`), allowed tools, and zone-scoped MCP servers. A 1-hour interval evicts sessions idle for >24h. **Not horizontally scalable** — replace with Redis before running >1 replica.

### Public-only is the product constraint

The DM/group-chat refusal in `bot.ts` is not a bug to "fix" or an edge case to soften. The README's "Why public-only" section explains it: every conversation must be searchable by the team. If you're tempted to add a DM mode, talk to the user first.

### Memory model

- **Channel/user memory** lives in `context/**/*.qmd` and **is checked into git**. The agent reads this on every turn and (per the roadmap) will eventually write back via PR — never directly.
- **Per-thread workspaces** live in `workspaces/<threadId>/` and are **gitignored**. They are scratch space for the agent's Bash/Read/Write/Edit tools.
- `.qmd` is Quarto markdown — YAML frontmatter + body. The frontmatter is the schema; the body is what the agent reads. Don't replace with plain `.md`.

### Zones

A zone (`zones/<name>/`) is a system-prompt prefix (`SKILL.md`) plus an MCP server manifest (`mcp.json`). Zones are how teams scope the agent's tools and knowledge to their codebase. The current code reads `SKILL.md` but **does not yet load `mcp.json`** — that's roadmapped.

## Model routing

- **Local dev**: `docker-compose.yml` points the Claude Agent SDK at LiteLLM (`ANTHROPIC_BASE_URL=http://litellm:4000`), which proxies to OpenRouter. The bot's `ANTHROPIC_AUTH_TOKEN` is `dummy` because LiteLLM does its own auth.
- **Production**: set `CLAUDE_CODE_USE_BEDROCK=1` and AWS creds. The SDK then talks to Bedrock directly — strip the LiteLLM service from compose.

## Things to know before editing

- **`src/agent.ts` line ~38**: there's an in-file comment that the `query()` option names ("systemPrompt", "resume", "mcpServers", "allowedTools") may drift across `@anthropic-ai/claude-agent-sdk` versions. If a build fails after a dep bump, check the SDK types before changing semantics.
- **The fire-and-forget pattern in `bot.ts`** is deliberate — Bot Framework activities must be acknowledged within ~15s. Long agent turns post back via `continueConversationAsync`. Don't `await runAgentTurn` inside `onMessage`.
- **In-thread replies**: Teams threads the bot's reply correctly because `getConversationReference(ctx.activity)` captures the originating message ID. Don't construct conversation references manually.
- **Session storage is in-memory.** A container restart loses every active SDK session. This is acknowledged tech debt; see roadmap.

## Local inner loop without Teams

The Bot Framework Emulator works against `http://localhost:3978/api/messages` with blank App ID / Password. To exercise the public-only gate vs. agent path, change the Emulator's conversation type between `personal` and `channel`.
