# ms-teams-agentic-muppet

A public-only agent for Microsoft Teams (the bot calls itself "Muppet"), modelled
on Shopify's River. Built on [Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk),
[Bot Framework](https://learn.microsoft.com/en-us/azure/bot-service/), and a
qmd-based memory system that lives in Git.

## Why public-only

Muppet refuses 1:1 chats and group chats. It only works in team channels, and
it threads replies under the originating message. The constraint is the point:
every conversation is searchable, every teammate can learn by watching, and the
agent's accumulated taste lives in version-controlled markdown that the team
owns.

## Architecture

```
Teams ──► Bot Framework adapter (src/index.ts)
            │
            ▼
        Public-only gate (src/bot.ts)
            │
            ▼
        Context loader (src/context.ts)
            │  reads zone + channel + user qmd
            ▼
        Claude Agent SDK session (src/agent.ts)
            │  per-thread, paused/resumed across turns
            ▼
        Anthropic API (local dev, ANTHROPIC_API_KEY)
        OR
        AWS Bedrock (production, CLAUDE_CODE_USE_BEDROCK=1)
```

## Local development

### Prerequisites

- Docker + docker-compose (OrbStack recommended on Apple Silicon)
- An Anthropic API key for local dev (or AWS creds for Bedrock in prod)
- Microsoft Bot Framework Emulator for the fast inner loop
- A Cloudflare Tunnel token (or ngrok / dev tunnels) once you need real Teams

### Inner loop: Bot Framework Emulator

The fastest path. No Azure, no tunnel, no Teams tenant.

```bash
cp .env.example .env
# Fill in ANTHROPIC_API_KEY at minimum

docker compose up --build
```

Then in Bot Framework Emulator:
- Open Bot URL: `http://localhost:3978/api/messages`
- Leave App ID / Password blank for local
- Send "hello" — should get the public-only refusal
- Switch conversation type to `channel` in Emulator settings and try again — should hit the agent

### Outer loop: real Teams

1. Register an Azure Bot resource (free `F0` tier is fine)
2. Add Microsoft Teams as a channel
3. Set the messaging endpoint to your Cloudflare Tunnel URL: `https://muppet-dev.yourdomain.com/api/messages`
4. Fill `MS_APP_ID` and `MS_APP_PASSWORD` in `.env`
5. Set `CF_TUNNEL_TOKEN` and `docker compose up`
6. Build the Teams app manifest via [Teams Developer Portal](https://dev.teams.microsoft.com) and sideload into a Microsoft 365 Developer Program tenant

## Project layout

```
ms-teams-agentic-muppet/
├── docker-compose.yml      # ms-teams-agentic-muppet + cloudflared (optional)
├── Dockerfile              # ms-teams-agentic-muppet service
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts            # Express + Bot Framework adapter
│   ├── bot.ts              # Activity handler + public-only gate
│   ├── agent.ts            # Claude Agent SDK handoff
│   ├── context.ts          # qmd memory loader
│   └── sessions.ts         # Per-thread session store (in-memory; swap for Redis)
├── zones/                  # Zone definitions, team-owned
│   └── example-zone/
│       ├── SKILL.md        # System prompt prefix, tool list, MCP servers
│       └── mcp.json
├── context/                # Memory store (git-backed)
│   ├── channels/<id>/memory.qmd
│   └── users/<aad_oid>/memory.qmd
└── workspaces/             # Per-thread sandboxes (gitignored)
```

## Roadmap

- [ ] `remember` tool: agent writes to qmd memory via PR, never directly to main
- [ ] Zone selection command (`@Muppet use zone <name>`)
- [ ] Streamed responses (batched `sendActivity` every ~1.5s to stay under Teams rate limits)
- [ ] Per-zone MCP server loading from `zones/<name>/mcp.json`
- [ ] Per-zone secret injection (AWS creds, `gh` token, warehouse credentials)
- [ ] Redis-backed session store for horizontal scaling
- [ ] Nightly memory distillation job
- [ ] Adaptive Cards renderer for PRs, test results, diffs

## Why qmd, not Markdown

`.qmd` files are Quarto markdown: YAML frontmatter, prose body, optional
executable code blocks. The frontmatter is where structured fields live
(`last_updated`, `schema_version`, `retention_policy`), the body is what the
agent reads and writes. Plain `.md` would do the job, but qmd's frontmatter
discipline keeps the memory machine-parseable without an extra schema layer.

## License

MIT — see `LICENSE`.
