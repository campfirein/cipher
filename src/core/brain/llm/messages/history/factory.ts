import { StorageManager } from '../../../../storage/manager.js';
import { DatabaseHistoryProvider } from './database.js';
import { IConversationHistoryProvider } from './types.js';

export function createDatabaseHistoryProvider(storageManager: StorageManager) {
	return new DatabaseHistoryProvider(storageManager);
}
