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

## Quickstart (WSL / Linux / macOS + Docker + Bedrock + Emulator)

The minimum to talk to the bot from your machine. No Teams tenant, no tunnel,
no Azure resources.

### 1. Install prerequisites

```bash
# Docker Desktop (with WSL2 backend on Windows) — install separately

# AWS CLI v2
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o awscli.zip
unzip awscli.zip && sudo ./aws/install

# Bot Framework Emulator (Windows / macOS / Linux installer)
# Download: https://github.com/Microsoft/BotFramework-Emulator/releases
```

(Bun is NOT required for the Quickstart — the Docker image runs it. You only
need Bun on the host if you want `bun run dev` outside Docker.)

### 2. Authenticate AWS once

```bash
aws configure sso          # for SSO (most enterprise setups)
# or
aws configure              # for static access keys
```

Verify it worked:

```bash
aws sts get-caller-identity --profile <your-profile-name>
```

### 3. Configure the bot

```bash
git clone <this-repo>
cd ms-teams-agentic-muppet
cp .env.example .env
```

Edit `.env`:
- `AWS_PROFILE` — the profile name you used with `aws configure`
- `AWS_REGION` — e.g. `us-east-1`
- `ANTHROPIC_MODEL` — a Bedrock model ID. List options with:
  `aws bedrock list-foundation-models --region us-east-1 --by-provider anthropic`

Leave the `MS_APP_*` and `CF_TUNNEL_TOKEN` lines blank — you don't need them yet.

### 4. Run

```bash
docker compose up --build
```

`docker-compose.yml` bind-mounts `~/.aws` into the container, so the SDK
picks up your AWS credentials automatically. You should see `ms-teams-agentic-muppet
listening on :3978`.

### 5. Test with Bot Framework Emulator

- Open Bot URL: `http://localhost:3978/api/messages`
- Leave App ID / Password blank
- Send "hello" — should get the public-only refusal (correct: DMs are blocked by design)
- In Emulator's conversation settings, set conversation type to `channel`, send another "hello" — should reach the agent and reply

That's the loop. Iterate by editing `src/**/*.ts`; `docker compose up --build`
to rebuild, or run `bun --watch src/index.ts` on the host for hot-reload (needs
`bun install` first).

## Setting up real Teams

Once the Emulator loop works, graduating to Teams is a separate (harder) step:

1. Register an Azure Bot resource (free `F0` tier is fine).
2. Add Microsoft Teams as a channel.
3. Set the messaging endpoint to your Cloudflare Tunnel URL: `https://muppet-dev.yourdomain.com/api/messages`.
4. Fill `MS_APP_ID` and `MS_APP_PASSWORD` in `.env`.
5. Set `CF_TUNNEL_TOKEN` and run `docker compose --profile tunnel up`.
6. Build the Teams app manifest via [Teams Developer Portal](https://dev.teams.microsoft.com) and sideload into a Microsoft 365 Developer Program tenant.

Note: this is the standard Microsoft Teams bot flow, not Incoming Webhooks
(which are one-way / publish-only and don't support `@`-mentions).

## Where state lives

| Host path | Container path | Type | Persists? | Purpose |
| --- | --- | --- | --- | --- |
| `./context/` | `/app/context` | bind mount | yes — committed to git | Channel + user qmd memory (read on every turn) |
| `./zones/` | `/app/zones` | bind mount | yes — committed to git | Zone definitions (`SKILL.md`, `mcp.json`) |
| (Docker named volume `workspaces`) | `/app/workspaces` | named volume | until `docker compose down -v` | Per-thread agent sandboxes — ephemeral by design |
| `~/.aws/` | `/root/.aws` (ro) | bind mount | host-managed | AWS creds + SSO token cache (used for Bedrock) |

The `workspaces` volume is deliberately NOT bind-mounted to the repo —
per-thread sandboxes can grow large and shouldn't pollute git. Inspect them
with `docker compose exec ms-teams-agentic-muppet ls /app/workspaces`.

To wipe all per-thread state: `docker compose down -v`. Channel/user memory
(`context/`) and zones (`zones/`) are unaffected because they live in the repo.

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
