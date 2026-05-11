import anthropic from '../../../../assets/providers/anthropic-provider.svg'
import byterover from '../../../../assets/providers/byterover-provider.svg'
import cerebras from '../../../../assets/providers/cerebras-provider.svg'
import cohere from '../../../../assets/providers/cohere-provider.svg'
import deepinfra from '../../../../assets/providers/deepinfra-provider.svg'
import deepseek from '../../../../assets/providers/deepseek-provider.svg'
import gemini from '../../../../assets/providers/gemini-provider.svg'
import groq from '../../../../assets/providers/groq-provider.svg'
import kimi from '../../../../assets/providers/kimi-provider.svg'
import minimax from '../../../../assets/providers/minimax-provider.svg'
import mistral from '../../../../assets/providers/mistral-provider.svg'
import openai from '../../../../assets/providers/openai-provider.svg'
import openrouter from '../../../../assets/providers/openrouter-provider.svg'
import perplexity from '../../../../assets/providers/perplexity-provider.svg'
import togetherAi from '../../../../assets/providers/together-ai-provider.svg'
import vercel from '../../../../assets/providers/vercel-provider.svg'
import xai from '../../../../assets/providers/xai-provider.svg'
import zai from '../../../../assets/providers/zai-provider.svg'

/** Maps provider ID to its icon SVG path. */
export const providerIcons: Record<string, string> = {
  anthropic,
  byterover,
  cerebras,
  cohere,
  deepinfra,
  deepseek,
  glm: zai,
  'glm-coding-plan': zai,
  google: gemini,
  groq,
  minimax,
  mistral,
  moonshot: kimi,
  openai,
  'openai-compatible': openai,
  openrouter,
  perplexity,
  togetherai: togetherAi,
  vercel,
  xai,
}
