import { MemAgent } from './agent.js';
import { AgentConfig } from './config.js';
import fs from 'fs';
import path from 'path';

async function main() {
  // Minimal valid config for OpenAI-only demo
  const config: AgentConfig = {
    systemPrompt: "You are an AI assistant.",
    mcpServers: {},
    llm: {
      provider: "openai",
      model: "gpt-4o-mini",
      apiKey: process.env.OPENAI_API_KEY || "",
    },
    // sessions is optional, will use defaults
  };

  const agent = new MemAgent(config);
  await agent.start();

  const userInput = 'Write a binary search tree in TypeScript.';
  const sessionId = 'demo-session';

  const response = await agent.run(userInput, undefined, sessionId);
  console.log('Agent response:', response);

  // Wait a moment for async embedding save
  await new Promise(res => setTimeout(res, 2000));

  // Check the chat memory file
  const chatMemoryPath = path.resolve(process.cwd(), 'memAgent', 'chat_memory.json');
  if (fs.existsSync(chatMemoryPath)) {
    const entries = JSON.parse(fs.readFileSync(chatMemoryPath, 'utf-8'));
    const lastEntry = entries[entries.length - 1];
    console.log('Last chat memory entry:', lastEntry);
  } else {
    console.log('No chat memory file found.');
  }
}

main().catch(console.error);