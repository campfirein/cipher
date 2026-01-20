# ByteRover CLI Command Reference

Run `brv <command> --help` for up-to-date usage, arguments, flags, and examples.

## Commands

- `brv` - Start interactive REPL session
- `brv curate` - Curate context to the context tree
- `brv query` - Query and retrieve information from the context tree
- `brv status` - Show CLI status and project information
- `brv push` - Push context tree to cloud
- `brv pull` - Pull context tree from cloud
- `brv connectors` - Manage agent connectors (rules/hooks)
- `brv space` - Space management (list, switch)
- `brv init` - Initialize project with ByteRover
- `brv new` - Start fresh session
- `brv reset` - Reset context tree (destructive)
- `brv login` - Sign in to ByteRover
- `brv logout` - Sign out from ByteRover

---

## Best Practices

### Efficient Workflow

1. **Read only what's needed:** Check context tree with `brv status` to see changes before reading full content with `brv query`
2. **Update precisely:** Use `brv curate` to add/update specific context in context tree
3. **Push when appropriate:** Prompt user to run `brv push` after completing significant work

### Context tree Management

- Use `brv curate` to directly add/update context in the context tree
