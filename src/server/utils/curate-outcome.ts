const CURATION_BLOCKED_PATTERNS = [
  /\b(?:blocked|failed|failure)\b.{0,120}\b(?:curat(?:e|ion|ing)|code_exec|tool(?:ing|s)?|rlm|sandbox)\b/i,
  /\b(?:curat(?:e|ion|ing)|code_exec|tool(?:ing|s)?|rlm|sandbox)\b.{0,120}\b(?:blocked|failed|failure)\b/i,
  /\b(?:cannot|can't|could not|unable to)\b.{0,120}\b(?:complete|perform|do|run|access|verify|use|call)\b.{0,120}\b(?:curat(?:e|ion|ing)|code_exec|tool(?:ing|s)?|rlm|sandbox)\b/i,
  /\b(?:curat(?:e|ion|ing)|code_exec|tool(?:ing|s)?|rlm|sandbox)\b.{0,120}\b(?:cannot|can't|could not|unable to)\b.{0,120}\b(?:complete|perform|do|run|access|verify|use|call)\b/i,
  /\b(?:required|necessary)\b.{0,120}\b(?:code_exec|tooling|tools?)\b.{0,120}\b(?:not|missing|unavailable|exposed|provided|registered)\b/i,
  /\b(?:code_exec|tooling|tools?)\b.{0,120}\b(?:not|missing|unavailable|exposed|provided|registered)\b/i,
]

export function isBlockedCurationResponse(response?: string): boolean {
  if (!response?.trim()) return false
  return CURATION_BLOCKED_PATTERNS.some((pattern) => pattern.test(response))
}

export function formatBlockedCurationMessage(response?: string): string {
  const firstLine = response?.split('\n').map((line) => line.trim()).find(Boolean)
  if (!firstLine) return 'Context curation blocked'
  const suffix = firstLine.length > 240 ? `${firstLine.slice(0, 237)}...` : firstLine
  return `Context curation blocked: ${suffix}`
}
