# CLI Specification

Core principles for dex CLI behavior.

## Principles

### No Silent Failures

Commands must never silently discard user input. If a command receives unexpected arguments, it must error with a helpful message.

### Explicit Over Implicit

Require explicit flags for important options rather than positional arguments that can be confused.

### Helpful Errors

Error messages should:

- State what went wrong
- Show correct usage
- Provide a hint when the mistake is common

### Consistent Patterns

- Task ID is always the first positional argument (when required)
- Use `--flag` for optional parameters
- Exit code 1 for errors, 0 for success
