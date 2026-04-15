import {z} from 'zod'

export const CWD_DESCRIPTION =
  'Absolute path to the project root — selects which ByteRover context tree to use ' +
  String.raw`(e.g., "/Users/me/code/myapp", "C:\\code\\myapp").` +
  '\n\n' +
  'When to provide:\n' +
  '- If your runtime does NOT expose any workspace/project context to you ' +
  '(e.g., Claude Desktop, hosted MCP, global Windsurf): you MUST provide cwd. ' +
  'Use the path the user mentions, or ASK the user for the absolute path if unknown.\n' +
  '- If your runtime DOES expose an open workspace/project root to you ' +
  '(e.g., Cursor, Cline, Zed, Claude Code): you can OMIT this field — ' +
  'the MCP server was launched from that same project and already knows the cwd. ' +
  'Providing it is harmless but unnecessary.\n' +
  '\n' +
  'Never guess, never invent paths, never use relative paths.'

export const cwdField = z.string().optional().describe(CWD_DESCRIPTION)
