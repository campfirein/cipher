/**
 * Image data interface
 */
export interface ImageData {
	image: string | Uint8Array | Buffer | ArrayBuffer | URL;
	mimeType?: string;
}

/**
 * Text segment interface
 */
export interface TextSegment {
	type: 'text';
	text: string;
}

/**
 * Image segment interface
 */
export interface ImageSegment extends ImageData {
	type: 'image';
}

/**
 * Internal message interface
 */
export interface InternalMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string | null | Array<TextSegment | ImageSegment>;
	toolCalls?: Array<{
		id: string;
		type: 'function';
		function: {
			name: string;
			arguments: string;
		};
	}>;
	toolCallId?: string;
	name?: string;
}
