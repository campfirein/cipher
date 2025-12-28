/**
 * Generate a session title from the first user message.
 * Uses heuristic extraction (no LLM call to avoid latency).
 *
 * @param firstMessage - The first user message in the conversation
 * @returns A concise title for the session
 */
export function generateSessionTitle(firstMessage: string): string {
  // Remove markdown, code blocks, etc.
  const cleaned = firstMessage
    .replaceAll(/```[\s\S]*?```/g, '') // Remove code blocks
    .replaceAll(/`[^`]+`/g, '') // Remove inline code
    .replaceAll(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Extract link text
    .replaceAll(/[#*_~]/g, '') // Remove markdown formatting chars
    .trim()

  // If nothing left after cleaning, use a generic title
  if (!cleaned) {
    return 'New conversation'
  }

  // Extract first sentence or meaningful chunk
  const firstSentence = cleaned.split(/[.!?\n]/)[0]?.trim() || cleaned

  // Truncate to reasonable length
  const maxLength = 50
  if (firstSentence.length <= maxLength) {
    return firstSentence
  }

  // Truncate at word boundary
  const truncated = firstSentence.slice(0, maxLength)
  const lastSpace = truncated.lastIndexOf(' ')
  return (lastSpace > 20 ? truncated.slice(0, lastSpace) : truncated) + '...'
}
