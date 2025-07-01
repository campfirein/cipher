#!/usr/bin/env node
import readline from 'readline';
import { config as dotenvConfig } from 'dotenv';
import { LongTermProgrammingMemory } from './longterm-memory.js';
import { OpenAIService } from '../llm/services/openai.js';
import { logger } from '../../logger/index.js';

dotenvConfig();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'text-embedding-ada-002';
const STORAGE_PATH = process.env.CHAT_MEMORY_PATH || 'memAgent/chat_memory.json';
const MAX_RETRIES = parseInt(process.env.EMBEDDING_RETRY || '3', 10);

if (!OPENAI_API_KEY) {
  console.error('Missing OPENAI_API_KEY in environment.');
  process.exit(1);
}

function askUserInput(prompt: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(prompt, answer => { rl.close(); resolve(answer); }));
}

async function generateCursorResponse(userPurpose: string): Promise<string> {
  // Minimal OpenAI chat completion (no context/tools)
  const openai = new (await import('openai')).default({ apiKey: OPENAI_API_KEY });
  const response = await openai.chat.completions.create({
    model: 'gpt-3.5-turbo',
    messages: [
      { role: 'system', content: 'You are Cursor, an AI coding assistant. Respond with code and explanations as needed.' },
      { role: 'user', content: userPurpose },
    ],
    temperature: 0.2,
    max_tokens: 512,
  });
  return response.choices[0]?.message?.content || '';
}

async function withRetry<T>(fn: () => Promise<T>, desc: string): Promise<T> {
  let attempt = 0;
  while (attempt < MAX_RETRIES) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      logger.error(`${desc} failed (attempt ${attempt}):`, err);
      if (attempt >= MAX_RETRIES) throw err;
      await new Promise(res => setTimeout(res, 500 * attempt));
    }
  }
  throw new Error(`${desc} failed after ${MAX_RETRIES} attempts.`);
}

async function main() {
  const userPurpose = await askUserInput('User purpose: ');
  logger.info('Generating Cursor response...');
  const cursorResponse = await withRetry(() => generateCursorResponse(userPurpose), 'OpenAI chat completion');
  logger.info('Storing chat interaction with embeddings...');
  await withRetry(() => LongTermProgrammingMemory.saveChatInteractionWithEmbeddings(userPurpose, cursorResponse, OPENAI_API_KEY), 'Embedding generation and storage');
  logger.info('Chat interaction saved successfully.');
}

main().catch(err => {
  logger.error('Fatal error:', err);
  process.exit(1);
}); 