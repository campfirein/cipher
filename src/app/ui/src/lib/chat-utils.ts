import {
	TextPart,
	ImagePart,
	FilePart,
	ToolResult,
	ToolResultError,
	ToolResultContent,
} from '@/types/chat';

// Type guards for content parts
export function isTextPart(part: unknown): part is TextPart {
	return (
		typeof part === 'object' &&
		part !== null &&
		'type' in part &&
		(part as { type: unknown }).type === 'text' &&
		'text' in part &&
		typeof (part as { text: unknown }).text === 'string'
	);
}

export function isImagePart(part: unknown): part is ImagePart {
	return (
		typeof part === 'object' &&
		part !== null &&
		'type' in part &&
		(part as { type: unknown }).type === 'image' &&
		'base64' in part &&
		'mimeType' in part &&
		typeof (part as { base64: unknown }).base64 === 'string' &&
		typeof (part as { mimeType: unknown }).mimeType === 'string'
	);
}

export function isFilePart(part: unknown): part is FilePart {
	return (
		typeof part === 'object' &&
		part !== null &&
		'type' in part &&
		(part as { type: unknown }).type === 'file' &&
		'data' in part &&
		'mimeType' in part &&
		typeof (part as { data: unknown }).data === 'string' &&
		typeof (part as { mimeType: unknown }).mimeType === 'string'
	);
}

// Type guards for tool results
export function isToolResultError(result: unknown): result is ToolResultError {
	return typeof result === 'object' && result !== null && 'error' in result;
}

export function isToolResultContent(result: unknown): result is ToolResultContent {
	return (
		typeof result === 'object' &&
		result !== null &&
		'content' in result &&
		Array.isArray((result as ToolResultContent).content)
	);
}

// ID generation utility
export const generateUniqueId = (): string =>
	`msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

// Utility to extract image URI from tool result
export function extractImageFromToolResult(result: ToolResult): string | null {
	if (typeof result === 'string' && result.startsWith('data:image')) {
		return result;
	}

	if (isToolResultContent(result)) {
		const imgPart = result.content.find(
			(p): p is ImagePart => isImagePart(p) || (p as any).type === 'image'
		);
		if (imgPart) {
			return `data:${imgPart.mimeType};base64,${imgPart.base64}`;
		}
	}

	if (typeof result === 'object' && result !== null) {
		const resultObj = result as Record<string, unknown>;

		// Handle various image field formats
		if ('data' in resultObj && 'mimeType' in resultObj) {
			return `data:${resultObj.mimeType};base64,${resultObj.data}`;
		}

		if ('screenshot' in resultObj && typeof resultObj.screenshot === 'string') {
			return resultObj.screenshot;
		}

		if ('image' in resultObj && typeof resultObj.image === 'string') {
			return resultObj.image;
		}

		if (
			'url' in resultObj &&
			typeof resultObj.url === 'string' &&
			resultObj.url.startsWith('data:image')
		) {
			return resultObj.url;
		}
	}

	return null;
}

// Utility to format tool result for display
export function formatToolResult(result: ToolResult): string {
	if (typeof result === 'string') {
		return result;
	}

	if (isToolResultError(result)) {
		return typeof result.error === 'string' ? result.error : JSON.stringify(result.error, null, 2);
	}

	if (isToolResultContent(result)) {
		return result.content
			.filter(isTextPart)
			.map(part => part.text)
			.join('\n');
	}

	return JSON.stringify(result, null, 2);
}

// Utility to check if message has image content
export function hasImageContent(content: string | null | Array<TextPart | ImagePart>): boolean {
	if (Array.isArray(content)) {
		return content.some(isImagePart);
	}
	return false;
}

// Utility to extract text from message content
export function extractTextFromContent(
	content: string | null | Array<TextPart | ImagePart>
): string {
	if (typeof content === 'string') {
		return content || '';
	}

	if (Array.isArray(content)) {
		return content
			.filter(isTextPart)
			.map(part => part.text)
			.join(' ');
	}

	return '';
}

// Utility to create custom DOM events
export function dispatchChatEvent(eventName: string, detail: Record<string, unknown>): void {
	if (typeof window !== 'undefined') {
		window.dispatchEvent(new CustomEvent(eventName, { detail }));
	}
}

// Convert ChatMessage to Message for compatibility
export function convertChatMessageToMessage(chatMessage: any): any {
	const converted = {
		...chatMessage,
		// For tool messages, keep content as null to ensure proper rendering
		content: chatMessage.role === 'tool' ? chatMessage.content : (chatMessage.content === null ? '' : chatMessage.content),
	};

	// Convert array content to proper format if needed
	if (Array.isArray(chatMessage.content)) {
		converted.content = chatMessage.content.map((part: any) => ({
			type: part.type,
			text: part.text,
			base64: part.base64,
			mimeType: part.mimeType,
			data: part.data,
			filename: part.filename,
		}));
	}

	return converted;
}
