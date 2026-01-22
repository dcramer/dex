# Agent Instructions

## Package Manager
Use **pnpm**: `pnpm install`, `pnpm build`, `pnpm test`

## Commit Attribution
AI commits MUST include:
```
Co-Authored-By: Claude <noreply@anthropic.com>
```

## Architecture
```
src/
├── index.ts           # Entry: routes to CLI or MCP
├── types.ts           # Zod schemas
├── core/              # Storage + TaskService
├── tools/             # MCP tool handlers
├── mcp/server.ts      # MCP server
└── cli/commands.ts    # CLI handlers
```

## Storage
One file per task: `.dex/tasks/{id}.json`

## Task Management
Use `dex` skill for todos. See `skills/dex/SKILL.md`
