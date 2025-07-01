import OpenAI from 'openai';

const PROMPT = (text: string) =>
  `Is the following message related to programming, coding, or software development? Answer only with "yes" or "no".\n\nExamples:\nMessage: How do I reverse a linked list in Python?\nAnswer: yes\nMessage: What's the weather like today?\nAnswer: no\nMessage: Can you explain what a REST API is?\nAnswer: yes\nMessage: Tell me a joke.\nAnswer: no\n\nMessage:\n${text}\n\nAnswer:`;

/**
 * Checks if a message is programming-related using OpenAI LLM.
 * @param text - The message to check for programming relevance.
 * @param apiKey - The OpenAI API key to use for the LLM call.
 * @returns Promise<boolean> - True if programming-related, false otherwise (including errors or unexpected LLM output).
 */
export async function isProgrammingRelatedLLM(text: string, apiKey: string): Promise<boolean> {
  const openai = new OpenAI({ apiKey });
  const prompt = PROMPT(text);
  try {
    // eslint-disable-next-line no-console
    console.debug('[isProgrammingRelatedLLM] Prompt:', prompt);
    const response = await openai.chat.completions.create({
      model: 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 1,
      temperature: 0,
    });
    const answer = response.choices[0]?.message?.content?.toLowerCase().trim();
    // eslint-disable-next-line no-console
    console.debug('[isProgrammingRelatedLLM] LLM response:', answer);
    if (answer === 'yes') return true;
    if (answer === 'no') return false;
    // Unexpected answer
    // eslint-disable-next-line no-console
    console.warn('[isProgrammingRelatedLLM] Unexpected LLM answer:', answer);
    return false;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('[isProgrammingRelatedLLM] LLM call failed:', error);
    return false;
  }
} 