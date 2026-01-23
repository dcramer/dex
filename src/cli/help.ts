import { colors } from "./utils.js";

export function helpCommand(): void {
  console.log(`${colors.bold}dex${colors.reset} - Task tracking tool

${colors.bold}USAGE:${colors.reset}
  dex <command> [options]

${colors.bold}COMMANDS:${colors.reset}
  init                             Create config file (~/.config/dex/dex.toml)
  mcp                              Start MCP server (stdio)
  create -d "..." --context "..."  Create task
  list                             List pending tasks (tree view)
  list --flat                      List without tree hierarchy
  list --all                       Include completed tasks
  list --status completed          Filter by status
  list --query "login"             Search description/context
  list --json                      Output as JSON (for scripts)
  show <id>                        View task details (truncated)
  show <id> --full                 View full context and result
  show <id> --json                 Output as JSON (for scripts)
  edit <id> [-d "..."]             Edit task
  complete <id> --result "..."     Mark completed with result
  delete <id>                      Remove task (prompts if has subtasks)
  delete <id> -f                   Force delete without confirmation

${colors.bold}OPTIONS:${colors.reset}
  --storage-path <path>            Override storage file location
  -p, --priority <n>               Task priority (lower = higher priority)
  --parent <id>                    Parent task (creates subtask)
  --json                           Output as JSON (list, show)

${colors.bold}ENVIRONMENT:${colors.reset}
  NO_COLOR                         Disable colored output

${colors.bold}EXAMPLES:${colors.reset}
  ${colors.dim}# Create with detailed context (requirements, approach, done criteria):${colors.reset}
  dex create -d "Add user auth" --context "Requirements:
    - JWT with refresh tokens
    - bcrypt for passwords
    Approach: /login, /register endpoints
    Done when: users can register/login, tests pass"

  ${colors.dim}# Complete with detailed result (what, decisions, follow-ups):${colors.reset}
  dex complete abc123 --result "Added JWT auth:
    - /login, /register, /logout endpoints
    - bcrypt cost=12, 15min access tokens
    Decisions: JWT over sessions for scaling
    Follow-up: add email verification"

  ${colors.dim}# Other common operations:${colors.reset}
  dex list --json | jq '.[] | .id'
  dex create -d "Subtask" --context "..." --parent abc123
`);
}
