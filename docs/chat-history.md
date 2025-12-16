# Chat History & Session Storage

Cipher supports persistent chat history using multiple storage backends. This allows conversations to be restored across application restarts and enables team collaboration features.

## Overview

Cipher stores chat history and session data using a hierarchical fallback system:
1. **PostgreSQL** (recommended for production)
2. **SQLite** (good for single-user setups)
3. **In-Memory** (development/testing only)

## PostgreSQL Configuration (Recommended)

PostgreSQL provides the best performance and reliability for chat history storage, especially in team environments.

### Connection URL Method (Recommended)

The simplest way to configure PostgreSQL:

```bash
# .env
CIPHER_PG_URL="postgresql://username:password@localhost:5432/cipher_db"
```

**URL Format:**
```
postgresql://[username[:password]@][host[:port]][/database][?param=value&...]
```

**Examples:**
```bash
# Local PostgreSQL
CIPHER_PG_URL="postgresql://postgres:password@localhost:5432/cipher_db"

# Cloud PostgreSQL (Heroku style)
CIPHER_PG_URL="postgresql://user:pass@hostname:5432/database?sslmode=require"

# Local PostgreSQL with SSL
CIPHER_PG_URL="postgresql://user:pass@localhost:5432/cipher_db?sslmode=prefer"
```

### Individual Parameters Method

Alternative configuration using separate environment variables:

```bash
# .env
STORAGE_DATABASE_HOST="localhost"
STORAGE_DATABASE_PORT="5432"
STORAGE_DATABASE_NAME="cipher_db"
STORAGE_DATABASE_USER="username"
STORAGE_DATABASE_PASSWORD="password"
STORAGE_DATABASE_SSL="false"
```

### Database Setup

1. **Create PostgreSQL Database:**

```sql
-- Connect to PostgreSQL as superuser
CREATE DATABASE cipher_db;
CREATE USER cipher_user WITH PASSWORD 'secure_password';
GRANT ALL PRIVILEGES ON DATABASE cipher_db TO cipher_user;
```

2. **Grant Schema Permissions:**

```sql
-- Connect to cipher_db
GRANT USAGE, CREATE ON SCHEMA public TO cipher_user;
GRANT ALL ON ALL TABLES IN SCHEMA public TO cipher_user;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO cipher_user;
```

3. **Automatic Schema Creation:**

Cipher will automatically create the necessary tables and indexes on first run:
- `sessions` - Session metadata and configuration
- `messages` - Chat messages and history
- Indexes for optimal query performance

### Cloud PostgreSQL Services

**Heroku Postgres:**
```bash
CIPHER_PG_URL=$DATABASE_URL  # Heroku provides this automatically
```

**Supabase:**
```bash
CIPHER_PG_URL="postgresql://postgres:[PASSWORD]@db.[PROJECT].supabase.co:5432/postgres"
```

**AWS RDS:**
```bash
CIPHER_PG_URL="postgresql://username:password@your-rds-instance.amazonaws.com:5432/cipher_db"
```

**Google Cloud SQL:**
```bash
CIPHER_PG_URL="postgresql://username:password@your-instance-ip:5432/cipher_db"
```

## SQLite Configuration

SQLite provides a good balance between features and simplicity for single-user setups.

### Automatic SQLite Fallback

If PostgreSQL is not configured, Cipher automatically uses SQLite:

```bash
# No additional configuration needed
# Cipher will create cipher_db.sqlite in the data directory
```

### Custom SQLite Location

```bash
# .env
STORAGE_DATABASE_PATH="/custom/path/to/data"
STORAGE_DATABASE_NAME="my-sessions.db"  # optional, defaults to cipher-sessions.db
```

**Features:**
- Single file database
- No server setup required
- Good performance for single users
- Portable between machines

## In-Memory Storage

For testing and development only:

```bash
# .env
STORAGE_DATABASE_TYPE="in-memory"
```

**Characteristics:**
- Fastest performance
- No persistence (data lost on restart)
- No disk usage
- Perfect for testing

## Session Management

### Session Storage Format

Sessions are stored with the following structure:

```json
{
  "sessionId": "unique-session-id",
  "metadata": {
    "createdAt": "2024-01-15T10:30:00Z",
    "lastActive": "2024-01-15T15:45:00Z",
    "messageCount": 42
  },
  "configuration": {
    "llm": { "provider": "openai", "model": "gpt-4" },
    "systemPrompt": "Custom prompt..."
  }
}
```

### Message Storage

Messages are stored with:

```json
{
  "messageId": "msg-123",
  "sessionId": "session-456", 
  "timestamp": "2024-01-15T10:30:00Z",
  "role": "user|assistant|system",
  "content": "Message content...",
  "metadata": {
    "tokens": 150,
    "model": "gpt-4",
    "tools": ["memory_search", "web_search"]
  }
}
```

## Storage Keys and Patterns

Cipher uses consistent key patterns for data organization:

### Session Data
- **Pattern:** `cipher:sessions:{sessionId}`
- **Content:** Session configuration and metadata

### Message History  
- **Pattern:** `messages:{sessionId}`
- **Content:** Array of messages for the session

### Workspace Data
- **Pattern:** `workspace:{sessionId}:*`
- **Content:** Workspace-specific memory and context

## Environment Variables Reference

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `CIPHER_PG_URL` | Complete PostgreSQL connection URL | None | No |
| `STORAGE_DATABASE_HOST` | PostgreSQL host | localhost | No |
| `STORAGE_DATABASE_PORT` | PostgreSQL port | 5432 | No |
| `STORAGE_DATABASE_NAME` | Database name (PostgreSQL) or filename (SQLite) | cipher-sessions.db | No |
| `STORAGE_DATABASE_USER` | Username | None | No |
| `STORAGE_DATABASE_PASSWORD` | Password | None | No |
| `STORAGE_DATABASE_SSL` | Enable SSL | false | No |
| `STORAGE_DATABASE_PATH` | SQLite directory path | ./data | No |
| `STORAGE_DATABASE_TYPE` | Force storage type | in-memory | No |

## Fallback Behavior

Cipher uses intelligent fallback for storage:

1. **PostgreSQL** - If `CIPHER_PG_URL` or individual DB params are set
2. **SQLite** - If PostgreSQL fails or isn't configured  
3. **In-Memory** - If all persistent storage fails

```
PostgreSQL Available? → Use PostgreSQL
        ↓ No
SQLite Available? → Use SQLite
        ↓ No
Use In-Memory → ⚠️ No persistence
```

## Data Migration

### Export Session Data

```bash
# Export from PostgreSQL
pg_dump -h localhost -U cipher_user -d cipher_db --table=sessions --table=messages > cipher_backup.sql

# Export from SQLite
sqlite3 cipher.db ".dump sessions messages" > cipher_backup.sql
```

### Import Session Data

```bash
# Import to PostgreSQL
psql -h localhost -U cipher_user -d cipher_db < cipher_backup.sql

# Import to SQLite
sqlite3 new_cipher.db < cipher_backup.sql
```

## Performance Optimization

### PostgreSQL Tuning

```sql
-- Indexes for better query performance (auto-created by Cipher)
CREATE INDEX idx_messages_session_timestamp ON messages(session_id, timestamp);
CREATE INDEX idx_sessions_last_active ON sessions(last_active);

-- For high-volume setups, consider connection pooling:
```

```bash
# .env - Connection pooling
CIPHER_PG_URL="postgresql://user:pass@localhost:5432/cipher_db?max_connections=10"
```

### SQLite Optimization

```bash
# .env - SQLite performance settings
SQLITE_CACHE_SIZE=2000
SQLITE_TEMP_STORE=memory
SQLITE_SYNCHRONOUS=normal
```


## Related Documentation

- [Configuration](./configuration.md) - Main configuration guide
- [Workspace Memory](./workspace-memory.md) - Team memory features
- [CLI Reference](./cli-reference.md) - Session management commands