# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
bun install       # install deps; generates/updates bun.lock
bun run lint      # tsc --noEmit (this repo's "lint" is a type-check; there is no ESLint)
bun run dev       # bun --watch src/index.ts (runs TS directly, restarts on change)
bun start         # bun src/index.ts (one-shot)

docker compose up --build              # local stack (just the bot service)
docker compose --profile tunnel up     # adds cloudflared for real-Teams testing
```

The runtime is **Bun**, not Node. Bun executes `src/*.ts` directly — there's no compile step and no `dist/`. `tsc` is kept only for type checking via `bun run lint`. `bun.lock` must exist before `docker build` (the Dockerfile uses `--frozen-lockfile`); run `bun install` once locally to create it.

There is **no test runner configured**. Don't claim tests pass — there are none to run. If you add tests, add the runner (`bun test` is built in) and a `test` script in the same change.

## Architecture

ms-teams-agentic-muppet is a Microsoft Teams bot (introduces itself as "Muppet") that hands every channel message off to a Claude Agent SDK session. Request flow:

1. **`src/index.ts`** — Express server on `:3978`. Hosts the Bot Framework `CloudAdapter` and exposes `/api/messages` (Bot Framework webhook) and `/healthz`. Also **exports `adapter`** because `agent.ts` re-imports it to post back asynchronously (`continueConversationAsync`). That circular import is load-bearing.
2. **`src/bot.ts`** — `MuppetBot` extends `ActivityHandler`. Enforces the **public-only gate**: `conversationType === 'personal'` and `'groupChat'` are rejected with a canned refusal. Only `channel` activity proceeds. After mention-stripping, it fires `runAgentTurn` **fire-and-forget** and immediately sends a `typing` activity so Teams doesn't time out.
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

The Claude Agent SDK has two native backends. `docker-compose.yml` passes env vars for both — set whichever you want and the SDK picks:

- **Bedrock (default / recommended)**: set `CLAUDE_CODE_USE_BEDROCK=1`, `AWS_PROFILE`, `AWS_REGION`, and `ANTHROPIC_MODEL` (a Bedrock model ID or inference profile ARN). The compose file **bind-mounts `~/.aws:/root/.aws:ro`**, so `aws configure sso` / `aws configure` on the host gives the container credentials automatically — no need to copy access keys into `.env` (though `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `AWS_SESSION_TOKEN` envs are still passed through if you prefer).
- **Direct Anthropic API**: set `ANTHROPIC_API_KEY` and leave the Bedrock vars blank. SDK calls `api.anthropic.com`. Useful when you don't have Bedrock access.

There's no default for `ANTHROPIC_MODEL` — the SDK picks one if unset, but for Bedrock you almost always want to pin the model ID for your region.

No proxy, no LiteLLM. If you ever need cross-provider routing or observability, add LiteLLM back and point the SDK at it via `ANTHROPIC_BASE_URL` — the SDK supports it natively.

## Things to know before editing

- **`src/agent.ts` line ~38**: there's an in-file comment that the `query()` option names ("systemPrompt", "resume", "mcpServers", "allowedTools") may drift across `@anthropic-ai/claude-agent-sdk` versions. If a build fails after a dep bump, check the SDK types before changing semantics.
- **The fire-and-forget pattern in `bot.ts`** is deliberate — Bot Framework activities must be acknowledged within ~15s. Long agent turns post back via `continueConversationAsync`. Don't `await runAgentTurn` inside `onMessage`.
- **In-thread replies**: Teams threads the bot's reply correctly because `getConversationReference(ctx.activity)` captures the originating message ID. Don't construct conversation references manually.
- **Session storage is in-memory.** A container restart loses every active SDK session. This is acknowledged tech debt; see roadmap.

## Local inner loop without Teams

The Bot Framework Emulator works against `http://localhost:3978/api/messages` with blank App ID / Password. To exercise the public-only gate vs. agent path, change the Emulator's conversation type between `personal` and `channel`.
