export function generateFishCompletion(): string {
  return `# dex fish completion
# Install: dex completion fish | source
# Or add to ~/.config/fish/config.fish: dex completion fish | source
# Or save to: dex completion fish > ~/.config/fish/completions/dex.fish

# Disable file completion by default
complete -c dex -f

# Helper function to get task IDs with descriptions
function __dex_task_ids
    if command -v jq &>/dev/null
        dex list --all --json 2>/dev/null | jq -r '.[] | "\\(.id)\\t\\(.name | .[0:50])"' 2>/dev/null
    else
        dex list --all --json 2>/dev/null | string match -r '"id": *"[^"]*"' | string replace -r '.*"([^"]+)".*' '$1'
    end
end

# Commands that need task ID completion
function __dex_needs_task_id
    set -l cmd (commandline -opc)
    test (count $cmd) -eq 2
    and contains -- $cmd[2] show edit update complete done delete rm remove
end

# Check if we're completing shell type for completion command
function __dex_needs_shell
    set -l cmd (commandline -opc)
    test (count $cmd) -eq 2
    and test "$cmd[2]" = "completion"
end

# Check if we're completing file for plan command
function __dex_needs_plan_file
    set -l cmd (commandline -opc)
    test (count $cmd) -eq 2
    and test "$cmd[2]" = "plan"
end

# Helper to check if completing first argument (command position)
function __dex_needs_command
    test (count (commandline -opc)) -eq 1
end

# Main commands
complete -c dex -n __dex_needs_command -a "init" -d "Create config file"
complete -c dex -n __dex_needs_command -a "config" -d "Get or set config values"
complete -c dex -n __dex_needs_command -a "create" -d "Create a new task"
complete -c dex -n __dex_needs_command -a "list" -d "List tasks"
complete -c dex -n __dex_needs_command -a "ls" -d "List tasks (alias)"
complete -c dex -n __dex_needs_command -a "show" -d "View task details"
complete -c dex -n __dex_needs_command -a "edit" -d "Edit a task"
complete -c dex -n __dex_needs_command -a "update" -d "Edit a task (alias)"
complete -c dex -n __dex_needs_command -a "complete" -d "Mark task as completed"
complete -c dex -n __dex_needs_command -a "done" -d "Mark task as completed (alias)"
complete -c dex -n __dex_needs_command -a "delete" -d "Remove a task"
complete -c dex -n __dex_needs_command -a "rm" -d "Remove a task (alias)"
complete -c dex -n __dex_needs_command -a "remove" -d "Remove a task (alias)"
complete -c dex -n __dex_needs_command -a "plan" -d "Create task from plan file"
complete -c dex -n __dex_needs_command -a "help" -d "Show help information"
complete -c dex -n __dex_needs_command -a "mcp" -d "Start MCP server"
complete -c dex -n __dex_needs_command -a "completion" -d "Generate shell completion"

# Task ID completion for relevant commands
complete -c dex -n __dex_needs_task_id -a "(__dex_task_ids)"

# Shell completion for completion command
complete -c dex -n __dex_needs_shell -a "bash" -d "Bash shell"
complete -c dex -n __dex_needs_shell -a "zsh" -d "Zsh shell"
complete -c dex -n __dex_needs_shell -a "fish" -d "Fish shell"

# File completion for plan command
complete -c dex -n __dex_needs_plan_file -F -k -a "*.md"

# create flags
complete -c dex -n "contains -- create (commandline -opc)" -s n -l name -d "Task name" -r
complete -c dex -n "contains -- create (commandline -opc)" -s d -l description -d "Task description" -r
complete -c dex -n "contains -- create (commandline -opc)" -s p -l priority -d "Task priority" -r
complete -c dex -n "contains -- create (commandline -opc)" -l parent -d "Parent task ID" -r -a "(__dex_task_ids)"
complete -c dex -n "contains -- create (commandline -opc)" -s h -l help -d "Show help"

# list/ls flags
complete -c dex -n "contains -- list (commandline -opc); or contains -- ls (commandline -opc)" -s a -l all -d "Include completed tasks"
complete -c dex -n "contains -- list (commandline -opc); or contains -- ls (commandline -opc)" -s s -l status -d "Filter by status" -r -a "pending completed"
complete -c dex -n "contains -- list (commandline -opc); or contains -- ls (commandline -opc)" -s q -l query -d "Search query" -r
complete -c dex -n "contains -- list (commandline -opc); or contains -- ls (commandline -opc)" -s f -l flat -d "Show flat list"
complete -c dex -n "contains -- list (commandline -opc); or contains -- ls (commandline -opc)" -l json -d "Output as JSON"
complete -c dex -n "contains -- list (commandline -opc); or contains -- ls (commandline -opc)" -s h -l help -d "Show help"

# show flags
complete -c dex -n "contains -- show (commandline -opc)" -l full -d "Show full description and result"
complete -c dex -n "contains -- show (commandline -opc)" -l json -d "Output as JSON"
complete -c dex -n "contains -- show (commandline -opc)" -s h -l help -d "Show help"

# edit/update flags
complete -c dex -n "contains -- edit (commandline -opc); or contains -- update (commandline -opc)" -s n -l name -d "New name" -r
complete -c dex -n "contains -- edit (commandline -opc); or contains -- update (commandline -opc)" -s d -l description -d "New description" -r
complete -c dex -n "contains -- edit (commandline -opc); or contains -- update (commandline -opc)" -s p -l priority -d "New priority" -r
complete -c dex -n "contains -- edit (commandline -opc); or contains -- update (commandline -opc)" -l parent -d "New parent task ID" -r -a "(__dex_task_ids)"
complete -c dex -n "contains -- edit (commandline -opc); or contains -- update (commandline -opc)" -s s -l status -d "New status" -r -a "pending completed"
complete -c dex -n "contains -- edit (commandline -opc); or contains -- update (commandline -opc)" -s h -l help -d "Show help"

# complete/done flags
complete -c dex -n "contains -- complete (commandline -opc); or contains -- done (commandline -opc)" -s r -l result -d "Completion result" -r
complete -c dex -n "contains -- complete (commandline -opc); or contains -- done (commandline -opc)" -s h -l help -d "Show help"

# delete/rm/remove flags
complete -c dex -n "contains -- delete (commandline -opc); or contains -- rm (commandline -opc); or contains -- remove (commandline -opc)" -s f -l force -d "Force delete"
complete -c dex -n "contains -- delete (commandline -opc); or contains -- rm (commandline -opc); or contains -- remove (commandline -opc)" -s h -l help -d "Show help"

# completion flags
complete -c dex -n "contains -- completion (commandline -opc)" -s h -l help -d "Show help"

# plan flags
complete -c dex -n "contains -- plan (commandline -opc)" -s h -l help -d "Show help"

# config flags
complete -c dex -n "contains -- config (commandline -opc)" -s g -l global -d "Use global config"
complete -c dex -n "contains -- config (commandline -opc)" -s l -l local -d "Use project config"
complete -c dex -n "contains -- config (commandline -opc)" -l unset -d "Remove config key"
complete -c dex -n "contains -- config (commandline -opc)" -l list -d "List all config values"
complete -c dex -n "contains -- config (commandline -opc)" -s h -l help -d "Show help"
`;
}
