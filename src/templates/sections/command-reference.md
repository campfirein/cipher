# ByteRover CLI Command Reference

## Memory Commands

### `brv add`

**Description:** Add content to the context tree (interactive or autonomous mode)

**Arguments:**

- `CONTENT`: Content to add to the context tree (triggers autonomous mode, optional)

**Flags:**

- `-v, --verbose`: Enable verbose debug output

**Examples:**

```bash
# Interactive mode (manually choose domain/topic)
brv add

# Autonomous mode with internal LLM (default)
brv add "User authentication uses JWT tokens with 24h expiry"
```

**Behavior:**

- Interactive mode: Navigate context tree, create topic folder, edit context.md
- Autonomous mode: LLM automatically places content in appropriate location

**Requirements:** Project must be initialized (run `brv init` first)

---

### `brv push`

**Description:** Push context tree to ByteRover memory storage

**Flags:**

- `-b, --branch <string>`: ByteRover branch name (default: "main", NOT git branch)
- `-y, --yes`: Skip confirmation prompt

**Examples:**

```bash
brv push
brv push --branch develop
```

---

### `brv status`

**Description**: Show CLI status and project information. Display local context tree managed by ByteRover CLI.

**Arguments:**

- `DIRECTORY`:Project directory (defaults to current directory).

**Flags:**

- `-f, --format=<option>`: [default: table] Output format. <options: table|json>

**Examples:**

```bash
brv status
brv status --format json
```

## Best Practices

### Efficient Workflow

1. **Read only what's needed:** Check context tree with `brv status` to see changes before reading full content
2. **Update precisely:** Use `brv add` to add/update specific context in context tree
3. **Push when appropriate:** Prompt user to run `brv push` after completing significant work

### Memory Management

- Use `brv add` to directly add/update context in the context tree
