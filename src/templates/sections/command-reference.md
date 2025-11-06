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

### `brv retrieve`

**Description:** Retrieve memories from ByteRover Memora service and save to local ACE playbook

**Flags:**

- `-q, --query <string>`: Search query string (required)
- `-n, --node-keys <string>`: Comma-separated list of node keys (file paths) to filter results

**Examples:**

```bash
brv retrieve --query "authentication best practices"
brv retrieve -q "error handling" -n "src/auth/login.ts,src/auth/oauth.ts"
brv retrieve -q "database connection issues"
```

**Behavior:**

- **Clears existing playbook first** (destructive operation)
- Retrieves memories and related memories from Memora service
- Combines both result sets into playbook
- Maps memory fields: `bulletId` → `id`, `tags` → `metadata.tags`, `nodeKeys` → `metadata.relatedFiles`
- Displays results with score, content preview (200 chars), and related file paths
- Fail-safe: warns on save error but still displays results

**Output:** Shows count of memories and related memories, displays each with score and content

**Requirements:** Must be authenticated and project initialized

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

1. **Retrieve wisely:** Use `brv retrieve` with specific queries and `--node-keys` to filter
2. **Read only what's needed:** Check playbook with `brv status` to see statistics before reading full content
3. **Update precisely:** Use `brv add` to add/update specific bullets or `brv complete` for complete workflow
4. **Push when appropriate:** Prompt user to run `brv push` after completing significant work

### Memory Management

**Retrieve pattern:**

- Use `brv add` to directly add/update bullets
- `brv retrieve` **clears existing playbook** - use carefully
- Retrieved memories use actual Memora tags (not "auto-generated")
- Both memories and related memories are saved to playbook
