/**
 * Tool-call arg formatting for inline display in the event log.
 *
 * Tool names match the daemon's registered tools (see
 * src/agent/core/domain/tools/constants.ts and
 * src/agent/resources/tools/*.txt). Mirrors the TUI's per-tool formatter at
 * src/tui/components/execution/execution-tool.tsx but emits plain strings.
 */

/* eslint-disable camelcase */

import type {ToolCallEvent} from '../types/stored-task'

type Args = Record<string, unknown>
type Formatter = (args: Args) => string

const path = (args: Args): string =>
  getString(args, 'path') ?? getString(args, 'file_path') ?? getString(args, 'filePath') ?? ''

const command = (args: Args): string => getString(args, 'command') ?? ''

const code = (args: Args): string => getString(args, 'code') ?? ''

const query = (args: Args): string => getString(args, 'query') ?? ''

const memoryKey = (args: Args): string =>
  getString(args, 'path') ?? getString(args, 'key') ?? getString(args, 'name') ?? ''

const grep = (args: Args): string => {
  const pattern = getString(args, 'pattern') ?? ''
  const where = getString(args, 'path')
  return where ? `${pattern} in ${where}` : pattern
}

const glob = (args: Args): string => {
  const pattern = getString(args, 'pattern') ?? ''
  const where = getString(args, 'path')
  return where ? `${pattern} in ${where}` : pattern
}

const arrayCount = (key: string, noun: string): Formatter => (args) => {
  const value = args[key]
  if (!Array.isArray(value)) return ''
  return `${value.length} ${noun}${value.length === 1 ? '' : 's'}`
}

const preview = (text: string, max = 80): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text

const FORMATTERS: Record<string, Formatter> = {
  agentic_map: (args) => path(args) || query(args),
  bash_exec: command,
  bash_output: (args) => getString(args, 'processId') ?? '',
  batch: arrayCount('calls', 'call'),
  code_exec: code,
  create_knowledge_topic: (args) => getString(args, 'path') ?? getString(args, 'topic') ?? '',
  curate: (args) => getString(args, 'title') ?? getString(args, 'path') ?? '',
  delete_memory: memoryKey,
  detect_domains: (args) => preview(getString(args, 'data') ?? '', 60),
  edit_file: path,
  edit_memory: memoryKey,
  expand_knowledge: (args) => getString(args, 'stubPath') ?? path(args),
  glob_files: glob,
  grep_content: grep,
  ingest_resource: (args) =>
    getString(args, 'source') ?? getString(args, 'url') ?? path(args),
  kill_process: (args) => getString(args, 'processId') ?? '',
  list_directory: path,
  list_memories: path,
  llm_map: (args) => path(args) || query(args),
  read_file: path,
  read_memory: memoryKey,
  read_todos: () => '',
  search_history: query,
  search_knowledge: query,
  swarm_query: query,
  swarm_store: (args) => preview(getString(args, 'content') ?? '', 60),
  write_file: path,
  write_memory: memoryKey,
  write_todos: arrayCount('todos', 'todo'),
}

function fallback(args: Args): string {
  const firstScalar = Object.entries(args).find(
    ([, value]) => typeof value === 'string' || typeof value === 'number',
  )
  return firstScalar ? String(firstScalar[1]) : ''
}

export function formatToolArgs(call: ToolCallEvent): string {
  const formatter = FORMATTERS[call.toolName]
  return formatter ? formatter(call.args) : fallback(call.args)
}

function getString(record: Args, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}
