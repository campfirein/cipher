import type {GenerateContentRequest, IContentGenerator} from '../../core/interfaces/i-content-generator.js'

/**
 * Consume generateContentStream() and return accumulated text.
 * Used instead of generateContent() because the ChatGPT OAuth Codex
 * endpoint requires stream: true in all requests.
 */
export async function streamToText(
  generator: IContentGenerator,
  request: GenerateContentRequest,
): Promise<string> {
  const chunks: string[] = []
  for await (const chunk of generator.generateContentStream(request)) {
    if (chunk.content) {
      chunks.push(chunk.content)
    }
  }

  return chunks.join('')
}
