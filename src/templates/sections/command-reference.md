# ByteRover CLI Command Reference

## Memory Commands

### `br add`

**Description:** Add or update a bullet in the playbook (bypasses ACE workflow for direct agent usage)

**Flags:**

- `-s, --section <string>`: Section name for the bullet (required)
- `-c, --content <string>`: Content of the bullet (required)
- `-b, --bullet-id <string>`: Bullet ID to update (optional, creates new if omitted)

**Examples:**

```bash
br add --section "Common Errors" --content "Authentication fails when token expires"
br add --section "Common Errors" --bullet-id "common-00001" --content "Updated: Auth fails when token expires"
br add -s "Best Practices" -c "Always validate user input before processing"
```

**Suggested Sections:** Common Errors, Best Practices, Strategies, Lessons Learned, Project Structure and Dependencies, Testing, Code Style and Quality, Styling and Design

**Behavior:**

- Warns if using non-standard section name
- Creates new bullet with auto-generated ID if `--bullet-id` not provided
- Updates existing bullet if `--bullet-id` matches existing bullet
- Displays bullet ID, section, content, and tags after operation

**Requirements:** Playbook must exist (run `br init` first)

---

### `br mem retrieve`

**Description:** Retrieve memories from ByteRover Memora service and save to local ACE playbook

**Flags:**

- `-q, --query <string>`: Search query string (required)
- `-n, --node-keys <string>`: Comma-separated list of node keys (file paths) to filter results

**Examples:**

```bash
br mem retrieve --query "authentication best practices"
br mem retrieve -q "error handling" -n "src/auth/login.ts,src/auth/oauth.ts"
br mem retrieve -q "database connection issues"
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

### `br mem push`

**Description:** Push playbook to ByteRover memory storage and clean up local ACE files

**Flags:**

- `-b, --branch <string>`: ByteRover branch name (default: "main", NOT git branch)

**Examples:**

```bash
br mem push
```

---

### `br show`

## Best Practices

### Efficient Workflow

1. **Retrieve wisely:** Use `br mem retrieve` with specific queries and `--node-keys` to filter
2. **Read only what's needed:** Check playbook with `br ace stats` before reading full content
3. **Update precisely:** Use `br add` to add/update specific bullets
4. **Push when appropriate:** Prompt user to run `br mem push` after completing significant work

### Memory Management

**Retrieve pattern:**

- Use `br add` to directly add/update bullets
- `br mem retrieve` **clears existing playbook** - use carefully
- Retrieved memories use actual Memora tags (not "auto-generated")
- Both memories and related memories are saved to playbook
