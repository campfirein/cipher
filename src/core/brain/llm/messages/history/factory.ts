import { StorageManager } from '../../../../storage/manager.js';
import { DatabaseHistoryProvider } from './database.js';

export function createDatabaseHistoryProvider(storageManager: StorageManager) {
	return new DatabaseHistoryProvider(storageManager);
}
