---
zone: example-zone
owners:
  - aad-oid-here
description: A starter zone. Copy this directory and edit for each team.
---

# Example Zone

This text is loaded into the agent's system prompt for any channel using this
zone. Use it to declare:

- The team this zone belongs to
- The codebase, repo, or service the agent should be familiar with
- House rules (naming conventions, PR template, review process)
- Pointers to the most important internal docs

## Tools available in this zone

By default the agent has Read, Write, Edit, Bash, Grep, Glob. Add MCP servers
in `mcp.json` to expose more — issue trackers, the warehouse, observability,
internal APIs.

## Style notes

Keep PR descriptions short. Always link the originating Teams thread. Prefer
small, single-purpose PRs over large ones.
