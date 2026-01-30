export function generateBashCompletion(): string {
  return `# dex bash completion
# Install: eval "$(dex completion bash)"
# Or add to ~/.bashrc: source <(dex completion bash)

_dex_completion() {
    local cur prev words cword
    _init_completion || return

    local commands="init config create list ls show edit update complete done delete rm remove plan help mcp completion"

    # Get task IDs for commands that need them
    _dex_task_ids() {
        dex list --all --json 2>/dev/null | grep -o '"id": *"[^"]*"' | cut -d'"' -f4
    }

    case "\${cword}" in
        1)
            # First argument: complete commands
            COMPREPLY=( \$(compgen -W "\${commands}" -- "\${cur}") )
            return 0
            ;;
        2)
            # Second argument: depends on command
            case "\${prev}" in
                show|edit|update|complete|done|delete|rm|remove)
                    COMPREPLY=( \$(compgen -W "\$(_dex_task_ids)" -- "\${cur}") )
                    return 0
                    ;;
                completion)
                    COMPREPLY=( \$(compgen -W "bash zsh fish" -- "\${cur}") )
                    return 0
                    ;;
                plan)
                    # File completion for plan command
                    _filedir
                    return 0
                    ;;
            esac
            ;;
    esac

    # Flag completion
    case "\${prev}" in
        --parent|--priority|-p|--description|-d|--result|-r|--query|-q|--add-blocker|--remove-blocker|--blocked-by|-b|--issue|--commit|-c)
            # These flags expect a value, no completion
            return 0
            ;;
    esac

    # Complete flags based on command
    if [[ "\${cur}" == -* ]]; then
        local cmd="\${words[1]}"
        local flags=""
        case "\${cmd}" in
            create)
                flags="--name -n --description -d --priority -p --parent --blocked-by -b --help -h"
                ;;
            list|ls)
                flags="--all -a --completed -c --archived --blocked -b --ready -r --in-progress -i --query -q --flat -f --issue --commit --json --help -h"
                ;;
            show)
                flags="--expand -e --full -f --json --help -h"
                ;;
            edit|update)
                flags="--name -n --description -d --priority -p --parent --add-blocker --remove-blocker --help -h"
                ;;
            complete|done)
                flags="--result -r --commit -c --help -h"
                ;;
            delete|rm|remove)
                flags="--force -f --help -h"
                ;;
            completion)
                flags="--help -h"
                ;;
            config)
                flags="--global -g --local -l --unset --list --help -h"
                ;;
        esac
        COMPREPLY=( \$(compgen -W "\${flags}" -- "\${cur}") )
        return 0
    fi

    return 0
}

complete -F _dex_completion dex
`;
}
