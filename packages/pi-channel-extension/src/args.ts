// Tiny argv parser for the `/channel <sub> ...` umbrella. Pi passes the
// raw string after the command name; we split on whitespace but honour
// double-quoted tokens so users can write `/channel mention pi-rev "@x hi"`.

export type ParsedArgs = {
  readonly subcommand: string | undefined
  readonly positional: readonly string[]
  readonly flags: Readonly<Record<string, string>>
}

export const parseArgs = (raw: string): ParsedArgs => {
  const tokens = tokenize(raw.trim())
  const [subcommand, ...rest] = tokens
  const positional: string[] = []
  const flags: Record<string, string> = {}

  for (let index = 0; index < rest.length; index += 1) {
    const tok = rest[index]
    if (tok === undefined) continue
    if (tok.startsWith('--')) {
      const name = tok.slice(2)
      const next = rest[index + 1]
      if (next !== undefined && !next.startsWith('--')) {
        flags[name] = next
        index += 1
      } else {
        flags[name] = 'true'
      }
    } else {
      positional.push(tok)
    }
  }

  return {flags, positional, subcommand}
}

const tokenize = (input: string): string[] => {
  const out: string[] = []
  let buf = ''
  let inQuote = false
  for (const ch of input) {
    if (ch === '"') {
      inQuote = !inQuote
      continue
    }

    if (!inQuote && /\s/.test(ch)) {
      if (buf !== '') {
        out.push(buf)
        buf = ''
      }

      continue
    }

    buf += ch
  }

  if (buf !== '') out.push(buf)
  return out
}
