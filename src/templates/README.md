# ByteRover CLI Template System

This directory contains template files used to generate agent instructions via the `br gen-rules` command.

## Directory Structure

```
src/templates/
├── base.md                      # Main template structure
├── sections/                    # Reusable content sections
│   ├── workflow.md               # workflow guide
│   └── command-reference.md     # All BR CLI commands documentation
└── README.md                    # This file
```

## Template Files

### `base.md`
The main template structure that combines all sections into the final output.

**Variables:**
- `{{agent_name}}` - Name of the agent (e.g., "Claude Code", "Cursor")
- `{{workflow}}` - Content from `sections/workflow.md`
- `{{command_reference}}` - Content from `sections/command-reference.md`

### `sections/workflow.md`
Complete guide to the ACE (Agentic Context Engineering) workflow:
- Quick start examples
- Command reference for ACE commands
- ADD vs UPDATE modes explanation
- Best practices for using ACE
- Examples with real use cases

### `sections/command-reference.md`
Comprehensive documentation of all BR CLI commands:
- Root commands (login, init, status, add, gen-rules, ace, push, retrieve, show, clear)
- Space commands (list, switch)

Each command includes:
- Description
- Arguments (if any)
- Flags with defaults
- Examples

## How It Works

1. User runs `br gen-rules`
2. User selects an agent (e.g., "Claude Code")
3. `RuleTemplateService` loads templates via `FsTemplateLoader`
4. Templates are assembled:
   - Load section templates (workflow, command-reference)
   - Substitute variables in base template
   - Combine all content
5. Output written to `.clinerules/byterover-rules.md`

## Variable Substitution

The template system supports simple variable substitution using `{{variable_name}}` syntax.

**Available Variables:**
- `{{agent_name}}` - Agent name selected by user
## Updating Templates

### To Update Command Documentation:
Edit `sections/command-reference.md` - changes will be reflected next time `br gen-rules` runs.

### To Update ACE Workflow Guide:
Edit `sections/workflow.md` - changes will be reflected next time `br gen-rules` runs.

### To Change Output Structure:
Edit `base.md` - modify how sections are combined.

## Best Practices

1. **Keep templates in sync with code**: When adding/modifying commands, update `command-reference.md`
2. **Use clear examples**: Show realistic use cases in examples
3. **Maintain markdown formatting**: Ensure proper headers, code blocks, and lists
4. **Test after changes**: Run `br gen-rules` and verify output in `.clinerules/byterover-rules.md`

## Future Enhancements

This template system is designed to support future improvements:
- Context-aware content (show different sections based on project state)
- Agent-specific customizations (per-agent template overrides)
- Conditional sections (e.g., show memory commands only if authenticated)
- Dynamic variable injection (project status, playbook stats, etc.)

## Technical Details

**Template Loader:** `src/infra/template/fs-template-loader.ts`
- Loads templates from filesystem
- Performs variable substitution
- Returns assembled content

**Template Service:** `src/infra/rule/rule-template-service.ts`
- Orchestrates template loading
- Builds final instruction content
- Injects agent-specific values

**Command:** `src/commands/gen-rules.ts`
- User-facing command
- Prompts for agent selection
- Writes output to `.clinerules/byterover-rules.md`
