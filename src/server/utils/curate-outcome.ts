const CURATION_BLOCKED_PATTERNS = [
  /\bcontext curation blocked\b/i,
  /\bi am blocked\b.{0,160}\b(?:curat(?:e|ion|ing)|code_exec|tool(?:ing|s)?|rlm|sandbox|session)\b/i,
  /\b(?:the curation agent|this curation)\b.{0,120}\b(?:blocked|could not|cannot|can't|unable to)\b/i,
  /\b(?:cannot|can't|could not|unable to)\b.{0,120}\b(?:complete|perform|do|run|access|verify|use|call)\b.{0,120}\b(?:proper\s+)?(?:rlm\s+)?curat(?:e|ion|ing)\b/i,
  /\b(?:required|necessary)\b.{0,80}\b(?:code_exec|tooling|tools?)\b.{0,80}\b(?:not|missing|unavailable|exposed|provided|registered)\b/i,
  /\b(?:code_exec|tooling|tools?)\b.{0,80}\b(?:not|missing|unavailable|exposed|provided|registered)\b.{0,80}\b(?:in this session|for (?:this|the) curation|to complete)\b/i,
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
