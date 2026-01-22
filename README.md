# dex

Task tracking for LLM workflows. CLI + MCP server.

## Install

```bash
pnpm install
pnpm run build
```

## Usage

### CLI

```bash
dex create -d "Fix auth bug" --context "Users getting 401 on refresh"
dex list
dex complete <id> --result "Fixed token expiry check"
dex help
```

### MCP Server

```bash
dex mcp
```

## Storage

Tasks stored in `.dex/tasks.json` (git root or home directory).

Override: `DEX_STORAGE_PATH` env var or `--storage-path` flag.
