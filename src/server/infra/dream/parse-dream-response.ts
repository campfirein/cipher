import type {z} from 'zod'

/**
 * Extract and validate a JSON response from LLM output.
 *
 * Tries two strategies in order:
 * 1. JSON inside a ```json code fence (first match, non-greedy)
 * 2. Raw JSON (first { to last })
 *
 * Returns null if no valid JSON matching the schema is found.
 */
export function parseDreamResponse<T>(response: string, schema: z.ZodType<T>): null | T {
  // Strategy 1: JSON in code fence
  const fenceMatch = response.match(/```json\s*([\s\S]*?)```/)
  if (fenceMatch) {
    const result = tryParse(fenceMatch[1], schema)
    if (result !== null) return result
  }

  // Strategy 2: Raw JSON (first { to last })
  const jsonMatch = response.match(/\{[\s\S]*\}/)
  if (jsonMatch) {
    const result = tryParse(jsonMatch[0], schema)
    if (result !== null) return result
  }

  return null
}

function tryParse<T>(raw: string, schema: z.ZodType<T>): null | T {
  try {
    const parsed = JSON.parse(raw)
    return schema.parse(parsed)
  } catch {
    return null
  }
}
