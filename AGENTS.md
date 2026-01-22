# Agent Instructions

## Package Manager
Use **pnpm**: `pnpm install`, `pnpm build`

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
- Per-repo: `<git-root>/.dex/tasks.json`
- Fallback: `~/.dex/tasks.json`

## Task Management
Use `dex` CLI (not TodoWrite): `/dex` or `dex create|list|complete`
