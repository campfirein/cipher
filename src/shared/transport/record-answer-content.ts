/**
 * Encode/decode helpers for `record-answer` task content payloads.
 *
 * Phase 5 Task 5.4. Packs {query, answer, fingerprint} as JSON for the
 * single-string transport content field. Both the CLI command
 * (`brv record-answer`) and the MCP tool (`brv_record_answer`) encode;
 * the daemon's RecordAnswerExecutor decodes.
 */

export interface RecordAnswerContentPayload {
  answer: string
  fingerprint: string
  query: string
}

export function encodeRecordAnswerContent(options: RecordAnswerContentPayload): string {
  return JSON.stringify({
    answer: options.answer,
    fingerprint: options.fingerprint,
    query: options.query,
  })
}

/**
 * Parse a JSON-encoded record-answer payload. Throws on malformed input
 * (unlike search/gather which fall back to plain query) — fingerprint and
 * answer are required, no sensible default.
 */
export function decodeRecordAnswerContent(content: string): RecordAnswerContentPayload {
  const parsed = JSON.parse(content) as Partial<RecordAnswerContentPayload>
  if (typeof parsed.query !== 'string' || !parsed.query) {
    throw new TypeError('record-answer payload missing query')
  }

  if (typeof parsed.answer !== 'string') {
    throw new TypeError('record-answer payload missing answer')
  }

  if (typeof parsed.fingerprint !== 'string' || !parsed.fingerprint) {
    throw new TypeError('record-answer payload missing fingerprint')
  }

  return {answer: parsed.answer, fingerprint: parsed.fingerprint, query: parsed.query}
}
