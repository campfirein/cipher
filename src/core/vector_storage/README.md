# Vector Storage Persistence

The in-memory vector storage backend supports automatic persistence to local files, allowing data to survive process restarts.

## Features

- ✅ **Automatic Persistence**: Data is automatically saved to local files
- ✅ **Automatic Loading**: Data is automatically loaded when reconnecting
- ✅ **Directory Creation**: Persistence directories are created automatically
- ✅ **Error Handling**: Graceful handling of file system errors
- ✅ **Configurable Paths**: Customizable persistence locations

## File Structure

When persistence is enabled, the following files are created:

```
{persistencePath}/
├── ann_index.faiss          # ANN index file (or placeholder)
├── ann_metadata.json        # ANN index metadata
└── payloads.json           # Vector metadata and payloads
```

## Usage Examples

### Basic Usage with Default Persistence

```typescript
import { createPersistentInMemoryStore } from './vector_storage/factory.js';

// Create persistent in-memory store (saves to './data/vector-storage')
const { manager, store } = await createPersistentInMemoryStore('my_collection');

// Add vectors with metadata
await store.insert(
  [[1, 2, 3], [4, 5, 6]],           // vectors
  ['doc1', 'doc2'],                  // ids
  [{ title: 'First' }, { title: 'Second' }]  // payloads
);

// Search vectors
const results = await store.search([1, 2, 3], 5);

// Disconnect (data is automatically saved)
await manager.disconnect();
```

### Custom Persistence Path

```typescript
// Custom persistence path
const { manager, store } = await createPersistentInMemoryStore(
  'my_collection',
  1536,  // dimension
  './my-custom-data/vectors'  // persistence path
);
```

### Manual Configuration

```typescript
import { createVectorStore } from './vector_storage/factory.js';

const config = {
  type: 'in-memory',
  collectionName: 'my_collection',
  dimension: 1536,
  maxVectors: 10000,
  annPersistIndex: true,        // Enable persistence
  annIndexPath: './data/vectors' // Persistence path
};

const { manager, store } = await createVectorStore(config);
```

### Disable Persistence

```typescript
const config = {
  type: 'in-memory',
  collectionName: 'my_collection',
  dimension: 1536,
  annPersistIndex: false  // Disable persistence
};

const { manager, store } = await createVectorStore(config);
```

## Persistence Behavior

### Automatic Saving
- Data is saved after each operation (insert, update, delete)
- Data is saved when disconnecting
- Data is saved when clearing the collection

### Automatic Loading
- Data is loaded when connecting (if persistence is enabled)
- If no existing data is found, starts with empty collection
- Graceful handling of corrupted or missing files

### Error Handling
- File system errors are logged but don't break operations
- Missing directories are created automatically
- Corrupted files result in starting with empty collection

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `annPersistIndex` | boolean | `true` | Enable/disable persistence |
| `annIndexPath` | string | `'./data/vector-storage'` | Path for persistence files |
| `maxVectors` | number | `10000` | Maximum vectors to store |
| `dimension` | number | `1536` | Vector dimension |

## File Formats

### payloads.json
```json
[
  ["doc1", {"title": "First Document", "category": "docs"}],
  ["doc2", {"title": "Second Document", "category": "docs"}]
]
```

### ann_metadata.json
```json
{
  "dimension": 1536,
  "algorithm": "brute-force",
  "vectorCount": 2,
  "faissAvailable": false,
  "vectors": [
    ["doc1", [1, 2, 3, ...]],
    ["doc2", [4, 5, 6, ...]]
  ]
}
```

## Best Practices

1. **Use Descriptive Collection Names**: Helps organize data across multiple collections
2. **Choose Appropriate Paths**: Use paths that are writable and accessible
3. **Monitor Disk Space**: Large vector collections can consume significant disk space
4. **Backup Important Data**: Consider backing up persistence directories for critical data
5. **Handle Errors Gracefully**: Always handle potential file system errors in your application

## Troubleshooting

### Data Not Persisting
- Check that `annPersistIndex` is set to `true`
- Verify the `annIndexPath` is writable
- Check application logs for file system errors

### Data Not Loading
- Verify the persistence files exist in the specified path
- Check file permissions
- Review logs for loading errors

### Performance Issues
- Consider disabling persistence for high-frequency operations
- Use separate collections for different data types
- Monitor disk I/O performance 