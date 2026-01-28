import { ASCII_BANNER } from "./utils.js";
import { colors } from "./colors.js";

export function helpCommand(): void {
  console.log(`${colors.bold}${ASCII_BANNER}${colors.reset}
Task tracking tool

${colors.bold}USAGE:${colors.reset}
  dex <command> [options]

${colors.bold}COMMANDS:${colors.reset}
  init                             Create config file (~/.config/dex/dex.toml)
  config <key>[=<value>]           Get or set config values
  dir                              Print task storage directory
  dir --global                     Print global dex config directory
  mcp                              Start MCP server (stdio)
  status                           Show dashboard overview (default)
  create "name" [--description "..."]  Create task
  add                                   Alias for create command
  list, ls                         List all pending tasks (tree view)
  list --flat                      List without tree hierarchy
  list --all                       Include completed tasks
  list --archived                  List archived tasks
  list --in-progress               List only in-progress tasks
  list --query "login"             Search name/description
  list --json                      Output as JSON (for scripts)
  show <id>...                     View task details (truncated)
  show <id> --expand               Show ancestor descriptions in tree
  show <id> --full                 View full description and result
  show <id> --json                 Output as JSON (for scripts)
  edit <id> [-n "..."]             Edit task
  update                           Alias for edit command
  start <id>                       Mark task as in progress
  start <id> --force               Re-claim task already in progress
  complete <id> --result "..."     Mark completed with result
  done                             Alias for complete command
  delete <id>                      Remove task (prompts if has subtasks)
  delete <id> -f                   Force delete without confirmation
  rm, remove                       Aliases for delete command
  archive <id>                     Archive completed task to reduce storage
  archive --older-than 60d         Archive tasks completed >60 days ago
  archive --completed              Archive ALL completed tasks
  plan <file>                      Create task from plan markdown file
  sync [id]                        Push tasks to GitHub/Shortcut
  sync --github                    Sync only to GitHub Issues
  sync --shortcut                  Sync only to Shortcut Stories
  import #N                        Import GitHub issue
  import sc#N                      Import Shortcut story
  import --all                     Import all dex-labeled items
  export <id>...                   Export tasks to GitHub (no sync back)
  completion <shell>               Generate shell completion script

${colors.bold}GLOBAL OPTIONS:${colors.reset}
  --version, -V                    Show version and exit
  --help, -h                       Show this help message
  --config <path>                  Use custom config file
  --storage-path <path>            Override storage file location

${colors.bold}COMMAND OPTIONS:${colors.reset}
  -p, --priority <n>               Task priority (lower = higher priority)
  --parent <id>                    Parent task (creates subtask)
  --json                           Output as JSON (list, show)

${colors.bold}ENVIRONMENT:${colors.reset}
  NO_COLOR                         Disable colored output

${colors.bold}EXAMPLES:${colors.reset}
  ${colors.dim}# Create with detailed description (requirements, approach, done criteria):${colors.reset}
  dex create "Add user auth" --description "Requirements:
    - JWT with refresh tokens
    - bcrypt for passwords
    Approach: /login, /register endpoints
    Done when: users can register/login, tests pass"

  ${colors.dim}# Create simple task (description optional):${colors.reset}
  dex create "Fix login bug"

  ${colors.dim}# Complete with detailed result (what, decisions, follow-ups):${colors.reset}
  dex complete abc123 --result "Added JWT auth:
    - /login, /register, /logout endpoints
    - bcrypt cost=12, 15min access tokens
    Decisions: JWT over sessions for scaling
    Follow-up: add email verification"

  ${colors.dim}# Create task from planning session:${colors.reset}
  dex plan ~/.claude/plans/my-plan.md

  ${colors.dim}# Other common operations:${colors.reset}
  dex list --json | jq '.[] | .id'
  dex create "Subtask" --description "..." --parent abc123

  ${colors.dim}# Sync tasks to external services:${colors.reset}
  dex sync                          # Sync to all configured services
  dex sync --github                 # Sync only to GitHub
  dex sync --shortcut               # Sync only to Shortcut
  dex sync --dry-run                # Preview what would be synced

  ${colors.dim}# Import from external services:${colors.reset}
  dex import #42                    # Import GitHub issue #42
  dex import sc#123                 # Import Shortcut story #123
  dex import --all                  # Import all dex-labeled items
  dex import --all --shortcut       # Import only from Shortcut
`);
}
