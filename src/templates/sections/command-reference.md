# ByteRover CLI Command Reference

## Memory Commands

### `brv add`

**Description:** Add or update a bullet in the playbook (bypasses ACE workflow for direct agent usage)

**Flags:**

- `-s, --section <string>`: Section name for the bullet (required)
- `-c, --content <string>`: Content of the bullet (required)
- `-b, --bullet-id <string>`: Bullet ID to update (optional, creates new if omitted)

**Examples:**

```bash
brv add --section "Common Errors" --content "Authentication fails when token expires"
brv add --section "Common Errors" --bullet-id "common-00001" --content "Updated: Auth fails when token expires"
brv add -s "Best Practices" -c "Always validate user input before processing"
```

**Suggested Sections:** Common Errors, Best Practices, Strategies, Lessons Learned, Project Structure and Dependencies, Testing, Code Style and Quality, Styling and Design

**Behavior:**

- Warns if using non-standard section name
- Creates new bullet with auto-generated ID if `--bullet-id` not provided
- Updates existing bullet if `--bullet-id` matches existing bullet
- Displays bullet ID, section, content, and tags after operation

**Requirements:** Playbook must exist (run `brv init` first)

---

### `brv push`

**Description:** Push playbook to ByteRover memory storage and clean up local ACE files

**Flags:**

- `-b, --branch <string>`: ByteRover branch name (default: "main", NOT git branch)
- `-y, --yes`: Skip confirmation prompt

**Examples:**

```bash
brv push
brv push --branch develop
```

---

### `brv complete`

**Description:** Complete ACE workflow: save executor output, generate reflection, and update playbook in one command

**Arguments:**

- `hint`: Short hint for naming output files (e.g., "user-auth", "bug-fix")
- `reasoning`: Detailed reasoning and approach for completing the task
- `finalAnswer`: The final answer/solution to the task

**Flags:**

- `-t, --tool-usage <string>`: Comma-separated list of tool calls with arguments (format: "ToolName:argument", required)
- `-f, --feedback <string>`: Environment feedback about task execution (e.g., "Tests passed", "Build failed", required)
- `-b, --bullet-ids <string>`: Comma-separated list of playbook bullet IDs referenced (optional)
- `-u, --update-bullet <string>`: Bullet ID to update with new knowledge (if not provided, adds new bullet)

**Examples:**

```bash
brv complete "user-auth" "Implemented OAuth2 flow" "Auth works" --tool-usage "Read:src/auth.ts,Edit:src/auth.ts,Bash:npm test" --feedback "All tests passed"
brv complete "validation-fix" "Analyzed validator" "Fixed bug" --tool-usage "Grep:pattern:\"validate\",Read:src/validator.ts" --bullet-ids "bullet-123" --feedback "Tests passed"
brv complete "auth-update" "Improved error handling" "Better errors" --tool-usage "Edit:src/auth.ts" --feedback "Tests passed" --update-bullet "bullet-5"
```

**Behavior:**

- **Phase 1 (Executor):** Saves executor output with hint, reasoning, answer, tool usage, and bullet IDs
- **Phase 2 (Reflector):** Auto-generates reflection based on feedback and applies tags to playbook
- **Phase 3 (Curator):** Creates delta operation (ADD or UPDATE) and applies to playbook
- Adds new bullet to "Lessons Learned" section with tag `['auto-generated']`
- If `--update-bullet` provided, updates existing bullet instead of adding new one
- Extracts file paths from tool usage and adds to bullet metadata as `relatedFiles`

**Output:** Shows summary with file paths, tags applied count, and delta operations breakdown

---

### `brv status`

**Description**: Show CLI status and project information. Display local ACE context (ACE playbook) managed by ByteRover CLI.

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

1. **Read only what's needed:** Check playbook with `brv status` to see statistics before reading full content
2. **Update precisely:** Use `brv add` to add/update specific bullets or `brv complete` for complete workflow
3. **Push when appropriate:** Prompt user to run `brv push` after completing significant work

### Memory Management

- Use `brv add` to directly add/update bullets
- Use `brv complete` for full ACE workflow
