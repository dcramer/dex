Use `/dex` for task management.

# Dex

Task tracking tool with dual interfaces: MCP server for LLM consumption and CLI for humans.

## Architecture

```
src/
├── index.ts           # Entry point: routes to CLI or MCP
├── types.ts           # Zod schemas for Task, TaskStore
├── core/
│   ├── storage.ts     # JSON file I/O
│   └── task-service.ts # Business logic
├── tools/             # MCP tool handlers
├── mcp/server.ts      # MCP server setup
└── cli/commands.ts    # CLI command handlers
```

## Development

```bash
pnpm install
pnpm run build
```

## Testing

```bash
# CLI
node dist/index.js create -d "Test" --context "..."
node dist/index.js list

# MCP server
node dist/index.js mcp
```

## Storage

Per-repo: `<git-root>/.dex/tasks.json`
Fallback: `~/.dex/tasks.json`
