# Text Normalization System

The Cipher Agent includes a comprehensive text normalization system that improves retrieval quality and search relevance by preprocessing text before embedding and storage. This system ensures consistent text processing across both storage and retrieval pipelines.

## Overview

Text normalization standardizes input text by applying various preprocessing steps such as:
- Case normalization (lowercase conversion)
- Punctuation removal
- Whitespace normalization
- Stopword removal
- Stemming and lemmatization
- Language-specific processing

## Configuration

### Environment Variables

Set the following environment variables in your `.env` file to configure normalization:

```bash
# Enable/disable normalization features
NORMALIZATION_ENABLED=true
NORMALIZATION_TOLOWERCASE=true
NORMALIZATION_REMOVEPUNCTUATION=true
NORMALIZATION_WHITESPACE=true
NORMALIZATION_STOPWORDS=true
NORMALIZATION_STEMMING=true
NORMALIZATION_LEMMATIZATION=false

# Language configuration
NORMALIZATION_LANGUAGE=ENGLISH

# Legacy data migration
NORMALIZATION_PAST_DATA=false
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `NORMALIZATION_TOLOWERCASE` | boolean | `false` | Convert text to lowercase |
| `NORMALIZATION_REMOVEPUNCTUATION` | boolean | `false` | Remove punctuation marks |
| `NORMALIZATION_WHITESPACE` | boolean | `false` | Normalize whitespace (trim and collapse) |
| `NORMALIZATION_STOPWORDS` | boolean | `false` | Remove common stopwords |
| `NORMALIZATION_STEMMING` | boolean | `false` | Apply word stemming |
| `NORMALIZATION_LEMMATIZATION` | boolean | `false` | Apply word lemmatization |
| `NORMALIZATION_LANGUAGE` | enum | `OTHER` | Language for processing (`ENGLISH` or `OTHER`) |
| `NORMALIZATION_PAST_DATA` | boolean | `false` | Enable migration of existing data |

## Usage

### Basic Usage

The normalization system is automatically integrated into the text processing pipeline. When you store or query text, it's automatically normalized based on your configuration:

```typescript
import { normalizeTextForRetrieval } from '@core/brain/embedding/utils.js';
import { InputRefinementConfig } from '@core/brain/embedding/config.js';

const config: InputRefinementConfig = {
  NORMALIZATION_TOLOWERCASE: true,
  NORMALIZATION_REMOVEPUNCTUATION: true,
  NORMALIZATION_WHITESPACE: true,
  NORMALIZATION_STOPWORDS: true,
  NORMALIZATION_STEMMING: true,
  NORMALIZATION_LEMMATIZATION: false,
  NORMALIZATION_LANGUAGE: 'ENGLISH',
  NORMALIZATION_PAST_DATA: false,
};

const originalText = "Hello, World! How are YOU doing?";
const normalizedText = normalizeTextForRetrieval(originalText, config);
// Result: "hello world"
```

### Advanced Configuration

You can fine-tune normalization by enabling specific features:

```typescript
// Only basic normalization
const basicConfig: InputRefinementConfig = {
  NORMALIZATION_TOLOWERCASE: true,
  NORMALIZATION_WHITESPACE: true,
  // All other options false/OTHER
};

// Advanced English processing
const advancedConfig: InputRefinementConfig = {
  NORMALIZATION_TOLOWERCASE: true,
  NORMALIZATION_REMOVEPUNCTUATION: true,
  NORMALIZATION_WHITESPACE: true,
  NORMALIZATION_STOPWORDS: true,
  NORMALIZATION_STEMMING: true,
  NORMALIZATION_LANGUAGE: 'ENGLISH',
};
```

## Integration Points

### 1. Storage Pipeline

Text is automatically normalized before embedding and storage:

```typescript
// In MemAgent.run() - input is normalized before processing
const normalizedInput = normalizeTextForRetrieval(input, this.config.inputRefinement);
```

### 2. Retrieval Pipeline

Query text is normalized to match stored content:

```typescript
// Search queries are normalized using the same configuration
const normalizedQuery = normalizeTextForRetrieval(queryText, config);
```

### 3. Vector Storage

The `VectorStoreManager` includes a `normalizeData` method for migrating existing data:

```typescript
// Migrate existing database content
const results = await vectorStoreManager.normalizeData(
  embeddingManager,
  normalizationConfig
);
```

## CLI Commands

### Audit and Migrate Existing Data

Use the CLI to audit and normalize existing database content:

```bash
# Start the agent and use the audit command
cipher
> /audit normalization
```

This command will:
1. Scan all stored entries in the vector database
2. Check if they've been normalized
3. Re-process and update entries that need normalization
4. Report statistics on the migration

## Examples

### Example 1: Basic Text Cleaning

```typescript
const input = "  Hello,   World!   \n\n  ";
const config = {
  NORMALIZATION_TOLOWERCASE: true,
  NORMALIZATION_REMOVEPUNCTUATION: true,
  NORMALIZATION_WHITESPACE: true,
  NORMALIZATION_LANGUAGE: 'OTHER'
};

const result = normalizeTextForRetrieval(input, config);
// Result: "hello world"
```

### Example 2: English Language Processing

```typescript
const input = "The quick brown fox jumps over the lazy dog!";
const config = {
  NORMALIZATION_TOLOWERCASE: true,
  NORMALIZATION_REMOVEPUNCTUATION: true,
  NORMALIZATION_WHITESPACE: true,
  NORMALIZATION_STOPWORDS: true,
  NORMALIZATION_STEMMING: true,
  NORMALIZATION_LANGUAGE: 'ENGLISH'
};

const result = normalizeTextForRetrieval(input, config);
// Result: "quick brown fox jump lazi dog" (stemmed)
```

### Example 3: Configuration Comparison

```typescript
const text = "Machine Learning: The Future!";

// No normalization
const original = normalizeTextForRetrieval(text, { 
  NORMALIZATION_LANGUAGE: 'OTHER' 
});
// Result: "Machine Learning: The Future!"

// Full normalization
const normalized = normalizeTextForRetrieval(text, {
  NORMALIZATION_TOLOWERCASE: true,
  NORMALIZATION_REMOVEPUNCTUATION: true,
  NORMALIZATION_WHITESPACE: true,
  NORMALIZATION_STOPWORDS: true,
  NORMALIZATION_STEMMING: true,
  NORMALIZATION_LANGUAGE: 'ENGLISH'
});
// Result: "machin learn futur"
```

## Benefits

### Improved Retrieval Quality

1. **Case-insensitive matching**: "AI" matches "ai" and "Ai"
2. **Punctuation-insensitive**: "What is AI?" matches "What is AI"
3. **Morphological matching**: "running" matches "run" and "runs"
4. **Noise reduction**: Removes stopwords like "the", "and", "or"

### Consistency

- Identical normalization applied to both stored content and search queries
- Deterministic output for identical inputs
- Configuration-driven behavior

### Performance

- Efficient processing with the Natural language processing library
- Batched operations for database migration
- Minimal impact on embedding generation time

## Language Support

Currently optimized for English text processing:

- **English** (`NORMALIZATION_LANGUAGE: 'ENGLISH'`): Full feature support including stopwords, stemming
- **Other** (`NORMALIZATION_LANGUAGE: 'OTHER'`): Basic normalization only (case, punctuation, whitespace)

## Migration and Backward Compatibility

### Migrating Existing Data

When enabling normalization on an existing system:

1. Set `NORMALIZATION_PAST_DATA=true` in your environment
2. Use the `/audit normalization` CLI command
3. Monitor the migration progress and statistics

### Backward Compatibility

- Existing functionality is preserved when normalization is disabled
- Partial configuration objects are supported
- Graceful handling of invalid or missing configuration

## Troubleshooting

### Common Issues

1. **Line breaks not removed**: Ensure `NORMALIZATION_WHITESPACE=true`
2. **Stopwords still present**: Verify `NORMALIZATION_LANGUAGE=ENGLISH` and `NORMALIZATION_STOPWORDS=true`
3. **Case sensitivity issues**: Enable `NORMALIZATION_TOLOWERCASE=true`

### Performance Issues

- For large datasets, use smaller batch sizes in migration
- Monitor memory usage during bulk operations
- Consider running migration during off-peak hours

### Debugging

Enable debug logging to see normalization in action:

```bash
DEBUG=cipher:* cipher
```

## Testing

The normalization system includes comprehensive tests:

```bash
# Run all normalization tests
npm run test:unit -- src/core/brain/embedding/__test__/

# Run specific test suites
npm run test:unit -- src/core/brain/embedding/__test__/utils.test.ts
npm run test:unit -- src/core/brain/embedding/__test__/retrieval-integration.test.ts
npm run test:unit -- src/core/brain/embedding/__test__/regression.test.ts
```

## API Reference

### `normalizeTextForRetrieval(input: string, config: InputRefinementConfig): string`

Normalizes input text according to the provided configuration.

**Parameters:**
- `input`: The text to normalize
- `config`: Normalization configuration object

**Returns:**
- Normalized text string

**Throws:**
- Error if input is null or undefined
- Error if config is invalid

### `VectorStoreManager.normalizeData(embeddingManager, config, batchSize?, force?)`

Migrates existing database content to apply normalization.

**Parameters:**
- `embeddingManager`: EmbeddingManager instance
- `config`: Normalization configuration
- `batchSize`: Number of entries to process per batch (default: 100)
- `force`: Re-process already normalized entries (default: false)

**Returns:**
- Statistics object with `updated`, `skipped`, and `failed` counts

## Best Practices

1. **Test configurations** thoroughly before deploying to production
2. **Backup your data** before running large-scale migrations
3. **Monitor performance** during migration operations
4. **Use consistent configuration** across all environments
5. **Start with conservative settings** and gradually enable more features
6. **Document your configuration** choices for your team

## Contributing

When contributing to the normalization system:

1. Add tests for new normalization features
2. Update this documentation for configuration changes
3. Ensure backward compatibility
4. Consider performance implications
5. Test with various languages and text types 