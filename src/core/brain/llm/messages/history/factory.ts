import { StorageManager } from '../../../../storage/manager.js';
import { DatabaseHistoryProvider } from './database.js';
import type { IConversationHistoryProvider } from './types.js';
import { MultiBackendHistoryProvider } from './multi-backend.js';
import { WALHistoryProvider } from './wal.js';

export function createDatabaseHistoryProvider(
	storage: StorageManager
): IConversationHistoryProvider {
	return new DatabaseHistoryProvider(storage);
}

export function createMultiBackendHistoryProvider(
	primary: IConversationHistoryProvider,
	backup: IConversationHistoryProvider,
	wal?: WALHistoryProvider,
	flushIntervalMs: number = 5000
) {
	if (!wal) wal = new WALHistoryProvider();
	return new MultiBackendHistoryProvider(primary, backup, wal, flushIntervalMs);
}
