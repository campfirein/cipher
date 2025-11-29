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
2. **Update precisely:** Use `brv add` to add/update specific bullets
3. **Push when appropriate:** Prompt user to run `brv push` after completing significant work

### Memory Management

- Use `brv add` to directly add/update bullets
