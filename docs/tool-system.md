# Tool system

Models propose tool calls. Forge validates, authorizes, executes, and records them.

## Interface

```ts
interface ForgeTool<I, O> {
  name: string;
  description: string;
  risk: "read" | "write" | "execute" | "network";
  inputSchema: ZodSchema<I>;
  execute(input: I, ctx: ToolContext): Promise<O>;
}
```

## v0 tools

| Tool | Risk | Purpose |
|------|------|---------|
| `list_files` | read | List workspace files |
| `read_file` | read | Read text file |
| `search_repository` | read | Substring search |
| `git_status` | read | `git status --short` |
| `git_diff` | read | `git diff` |
| `write_file` | write | Write/overwrite file |
| `apply_patch` | write | Exact text replacement |
| `run_command` | execute | Allowlisted command |

## Policy

`DefaultPolicyEngine` denies unknown tools, network risk, secret-like paths, and disabled risk classes.

## Extending

1. Define a tool with `defineTool`
2. Register in `createRepositoryTools` (or a new registry)
3. Add policy tests for any security-sensitive behavior
