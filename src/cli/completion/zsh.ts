export function generateZshCompletion(): string {
  return `#compdef dex
# dex zsh completion
# Install: eval "$(dex completion zsh)"
# Or add to ~/.zshrc: source <(dex completion zsh)
# Note: You may need to run 'autoload -Uz compinit && compinit' first

_dex() {
    local -a commands
    commands=(
        'init:Create config file'
        'config:Get or set config values'
        'create:Create a new task'
        'list:List tasks'
        'ls:List tasks (alias)'
        'show:View task details'
        'edit:Edit a task'
        'update:Edit a task (alias)'
        'complete:Mark task as completed'
        'done:Mark task as completed (alias)'
        'delete:Remove a task'
        'rm:Remove a task (alias)'
        'remove:Remove a task (alias)'
        'plan:Create task from plan file'
        'help:Show help information'
        'mcp:Start MCP server'
        'completion:Generate shell completion script'
    )

    _dex_task_ids() {
        local -a tasks
        if command -v jq &>/dev/null; then
            tasks=(\${(f)"\$(dex list --all --json 2>/dev/null | jq -r '.[] | "\\(.id):\\(.name | .[0:50])"' 2>/dev/null)"})
        else
            tasks=(\${(f)"\$(dex list --all --json 2>/dev/null | grep -o '"id": *"[^"]*"' | cut -d'"' -f4)"})
        fi
        _describe 'task' tasks
    }

    _arguments -C \\
        '1: :->command' \\
        '*:: :->args'

    case \$state in
        command)
            _describe 'command' commands
            ;;
        args)
            case \$words[1] in
                show|edit|update|complete|done|delete|rm|remove)
                    _arguments \\
                        '1: :_dex_task_ids' \\
                        '*: :->flags'
                    case \$words[1] in
                        show)
                            _arguments \\
                                '--full[Show full description and result]' \\
                                '--json[Output as JSON]' \\
                                '(-h --help)'{-h,--help}'[Show help]'
                            ;;
                        edit|update)
                            _arguments \\
                                '(-n --name)'{-n,--name}'[New name]:name:' \\
                                '(-d --description)'{-d,--description}'[New description]:description:' \\
                                '(-p --priority)'{-p,--priority}'[New priority]:priority:' \\
                                '--parent[New parent task ID]:parent:_dex_task_ids' \\
                                '(-s --status)'{-s,--status}'[New status]:status:(pending completed)' \\
                                '(-h --help)'{-h,--help}'[Show help]'
                            ;;
                        complete|done)
                            _arguments \\
                                '(-r --result)'{-r,--result}'[Completion result]:result:' \\
                                '(-h --help)'{-h,--help}'[Show help]'
                            ;;
                        delete|rm|remove)
                            _arguments \\
                                '(-f --force)'{-f,--force}'[Force delete without confirmation]' \\
                                '(-h --help)'{-h,--help}'[Show help]'
                            ;;
                    esac
                    ;;
                create)
                    _arguments \\
                        '(-n --name)'{-n,--name}'[Task name]:name:' \\
                        '(-d --description)'{-d,--description}'[Task description]:description:' \\
                        '(-p --priority)'{-p,--priority}'[Task priority]:priority:' \\
                        '--parent[Parent task ID]:parent:_dex_task_ids' \\
                        '(-h --help)'{-h,--help}'[Show help]'
                    ;;
                list|ls)
                    _arguments \\
                        '(-a --all)'{-a,--all}'[Include completed tasks]' \\
                        '(-s --status)'{-s,--status}'[Filter by status]:status:(pending completed)' \\
                        '(-q --query)'{-q,--query}'[Search query]:query:' \\
                        '(-f --flat)'{-f,--flat}'[Show flat list]' \\
                        '--json[Output as JSON]' \\
                        '(-h --help)'{-h,--help}'[Show help]'
                    ;;
                plan)
                    _arguments \\
                        '1:plan file:_files -g "*.md"' \\
                        '(-h --help)'{-h,--help}'[Show help]'
                    ;;
                completion)
                    _arguments \\
                        '1:shell:(bash zsh fish)' \\
                        '(-h --help)'{-h,--help}'[Show help]'
                    ;;
                config)
                    _arguments \\
                        '(-g --global)'{-g,--global}'[Use global config]' \\
                        '(-l --local)'{-l,--local}'[Use project config]' \\
                        '--unset[Remove config key]' \\
                        '--list[List all config values]' \\
                        '(-h --help)'{-h,--help}'[Show help]'
                    ;;
            esac
            ;;
    esac
}

# Register completion function with zsh
if (( \$+functions[compdef] )); then
    compdef _dex dex 2>/dev/null
fi
`;
}
