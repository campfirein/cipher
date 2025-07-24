import { IMessageFormatter } from './types.js';
import { InternalMessage } from '../types.js';

// Anthropic (Claude) formatter
export class BedrockAnthropicMessageFormatter implements IMessageFormatter {
    format(message: Readonly<InternalMessage>, systemPrompt: string | null = null, tools?: any[]): any[] {
        const role = message.role;
        let contentArr: any[] = [];
        if (role === 'user' || role === 'assistant') {
            if (typeof message.content === 'string') {
                contentArr.push({ type: 'text', text: message.content });
            } else if (Array.isArray(message.content)) {
                for (const c of message.content) {
                    if (typeof c === 'string') {
                        contentArr.push({ type: 'text', text: c });
                    } else if (c.type === 'image') {
                        contentArr.push({ type: 'image', image: c.image, mimeType: c.mimeType });
                    } else if (c.type === 'text') {
                        contentArr.push({ type: 'text', text: c.text });
                    }
                }
            }
        }
        return [{ role, content: contentArr }];
    }
    parseResponse(response: any): InternalMessage[] {
        const internal: InternalMessage[] = [];
        if (!response || !response.content) return internal;
        for (const block of response.content) {
            if (block.type === 'text') {
                internal.push({ role: 'assistant', content: block.text });
            } else if (block.type === 'tool_use') {
                internal.push({
                    role: 'assistant',
                    content: '',
                    toolCalls: [{
                        id: block.id,
                        type: 'function',
                        function: {
                            name: block.name,
                            arguments: JSON.stringify(block.input),
                        },
                    }],
                });
            }
        }
        return internal;
    }
    formatTools(tools: any): any[] {
        if (!tools || typeof tools !== 'object') return [];
        return Object.entries(tools).map(([toolName, tool]: [string, any]) => ({
            name: toolName,
            description: tool.description,
            input_schema: tool.parameters,
        }));
    }
}

// Llama formatter
export class BedrockLlamaMessageFormatter implements IMessageFormatter {
    format(message: Readonly<InternalMessage>, systemPrompt: string | null = null): any[] {
        let prompt = '<|begin_of_text|>';
        if (systemPrompt) {
            prompt += `<|start_header_id|>system<|end_header_id|> ${systemPrompt} <|eot_id|>`;
        }
        const role = message.role === 'assistant' ? 'assistant' : 'user';
        const content = Array.isArray(message.content)
            ? message.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('')
            : message.content;
        prompt += `<|start_header_id|>${role}<|end_header_id|> ${content} <|eot_id|>`;
        prompt += '<|start_header_id|>assistant<|end_header_id|>';
        return [{
            prompt,
            max_gen_len: 512,
            temperature: 0.5,
            top_p: 0.9,
        }];
    }
    parseResponse(response: any): InternalMessage[] {
        return [{ role: 'assistant', content: response.generation }];
    }
    formatTools(tools: any): any[] { return []; }
}

// Titan formatter
export class BedrockTitanMessageFormatter implements IMessageFormatter {
    format(message: Readonly<InternalMessage>, systemPrompt: string | null = null): any[] {
        let inputText = '';
        if (systemPrompt) {
            inputText += `${systemPrompt}\n\n`;
        }
        const role = message.role === 'assistant' ? 'Bot' : 'User';
        const content = Array.isArray(message.content)
            ? message.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('')
            : message.content;
        inputText += `${role}: ${content}\n`;
        inputText += 'Bot:';
        return [{
            inputText,
            textGenerationConfig: {
                maxTokenCount: 512,
                temperature: 0.7,
                topP: 0.9,
                stopSequences: [],
            },
        }];
    }
    parseResponse(response: any): InternalMessage[] {
        const textContent = response.results.map((result: any) => result.outputText).join('');
        return [{ role: 'assistant', content: textContent }];
    }
    formatTools(tools: any): any[] { return []; }
}

// DeepSeek formatter
export class BedrockDeepSeekMessageFormatter implements IMessageFormatter {
    format(message: Readonly<InternalMessage>, systemPrompt: string | null = null): any[] {
        let prompt = '<｜begin of sentence｜>';
        let firstUserMessage = true;
        const content = Array.isArray(message.content)
            ? message.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('')
            : message.content;
        if (message.role === 'user') {
            let userContent = content;
            if (firstUserMessage && systemPrompt) {
                userContent = `${systemPrompt}\n\n${content}`;
                firstUserMessage = false;
            }
            prompt += ' ' + userContent;
        } else if (message.role === 'assistant') {
            prompt += ' ' + content;
        }
        prompt += ' <think>\n';
        return [{
            prompt,
            temperature: 0.5,
            top_p: 0.9,
            max_tokens: 512,
        }];
    }
    parseResponse(response: any): InternalMessage[] {
        const textContent = response.choices.map((choice: any) => choice.text).join('');
        return [{ role: 'assistant', content: textContent }];
    }
    formatTools(tools: any): any[] { return []; }
}

// AI21 formatter
export class BedrockAI21MessageFormatter implements IMessageFormatter {
    format(message: Readonly<InternalMessage>, systemPrompt: string | null = null): any[] {
        const ai21Messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];
        if (systemPrompt) {
            ai21Messages.push({ role: 'system', content: systemPrompt });
        }
        const content = Array.isArray(message.content)
            ? message.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('')
            : message.content;
        ai21Messages.push({
            role: message.role as 'user' | 'assistant' | 'system',
            content,
        });
        return [{
            messages: ai21Messages,
            temperature: 1.0,
            top_p: 1.0,
            max_tokens: 4096,
            frequency_penalty: 0,
            presence_penalty: 0,
        }];
    }
    parseResponse(response: any): InternalMessage[] {
        const textContent = response.choices.map((choice: any) => choice.message.content).join('');
        return [{ role: 'assistant', content: textContent }];
    }
    formatTools(tools: any): any[] { return []; }
} 