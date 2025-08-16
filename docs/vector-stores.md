# Vector Stores

Vector stores are databases optimized for storing and searching high-dimensional vectors (embeddings). Cipher supports multiple vector database providers for flexible deployment options.

## Supported Vector Stores

Cipher supports six vector database types:
- **Qdrant** - High-performance vector search engine
- **Milvus** - Open-source vector database with cloud options
- **ChromaDB** - Developer-friendly open-source embedding database
- **Pinecone** - Managed vector database service
- **Pgvector** - PostgreSQL extension with ACID compliance and enterprise features
- **In-Memory** - Built-in solution for development/testing

## Vector Store Configurations

<details>
<summary><strong>🔧 Qdrant Configuration</strong></summary>

[Qdrant](https://qdrant.tech/) is a high-performance vector search engine with excellent performance and features.

### ☁️ Qdrant Cloud (Managed)

The easiest way to get started with Qdrant:

```bash
# .env configuration
VECTOR_STORE_TYPE=qdrant
VECTOR_STORE_URL=https://your-cluster.qdrant.io
VECTOR_STORE_API_KEY=your-qdrant-api-key
```

**Setup Steps:**
1. Create account at [Qdrant Cloud](https://cloud.qdrant.io/)
2. Create a new cluster
3. Copy your cluster URL and API key
4. Add to your `.env` file or your `json` mcp config

### 🐳 Qdrant Local (Docker)

Run Qdrant locally using Docker:

```bash
# Basic setup (data lost on removing the container)
docker run -d --name qdrant-basic -p 6333:6333 qdrant/qdrant

# With persistent storage
docker run -d --name qdrant-storage -v ./qdrant-data:/qdrant/storage -p 6333:6333 qdrant/qdrant
```

```bash
# .env configuration
VECTOR_STORE_TYPE=qdrant
VECTOR_STORE_HOST=localhost
VECTOR_STORE_PORT=6333
VECTOR_STORE_URL=http://localhost:6333
```

### 🐳 Qdrant Docker Compose

Add to your `docker-compose.yml`:

```yaml
services:
  qdrant:
    image: qdrant/qdrant:latest
    ports:
      - "6333:6333"
    volumes:
      - qdrant_data:/qdrant/storage
    environment:
      - QDRANT__SERVICE__HTTP_PORT=6333

volumes:
  qdrant_data:
```

</details>

<details>
<summary><strong>🔧 Milvus Configuration</strong></summary>

[Milvus](https://milvus.io/) is an open-source vector database with excellent scalability.

### ☁️ Zilliz Cloud (Managed Milvus)

[Zilliz Cloud](https://zilliz.com/) provides managed Milvus hosting:

```bash
# .env configuration
VECTOR_STORE_TYPE=milvus
VECTOR_STORE_URL=your-milvus-cluster-endpoint
VECTOR_STORE_USERNAME=your-zilliz-username
VECTOR_STORE_PASSWORD=your-zilliz-password
```

**Setup Steps:**
1. Create account at [Zilliz Cloud](https://cloud.zilliz.com/)
2. Create a new cluster
3. Get your cluster endpoint and credentials
4. Add to your `.env` file or your `json` mcp config

### 🐳 Milvus Local (Docker)

Run Milvus locally using the official installation script:

```bash
# Download the official installation script
curl -sfL https://raw.githubusercontent.com/milvus-io/milvus/master/scripts/standalone_embed.sh -o standalone_embed.sh

# Start the Docker container
bash standalone_embed.sh start
```

```bash
# .env configuration
VECTOR_STORE_TYPE=milvus
VECTOR_STORE_HOST=localhost
VECTOR_STORE_PORT=19530
```

**Services Started:**
- **Milvus server**: Port 19530
- **Embedded etcd**: Port 2379  
- **Web UI**: http://127.0.0.1:9091/webui/
- **Data volume**: `volumes/milvus`

**Service Management:**
```bash
# Restart Milvus
bash standalone_embed.sh restart

# Stop Milvus
bash standalone_embed.sh stop

# Upgrade Milvus
bash standalone_embed.sh upgrade

# Delete Milvus (removes all data)
bash standalone_embed.sh delete
```

</details>

<details>
<summary><strong>🔧 ChromaDB Configuration</strong></summary>

[ChromaDB](https://www.trychroma.com/) is a developer-friendly open-source embedding database designed for AI applications.

### ☁️ ChromaDB Cloud (Managed)

ChromaDB offers managed cloud hosting for production deployments:

```bash
# .env configuration
VECTOR_STORE_TYPE=chroma
VECTOR_STORE_URL=https://your-chroma-instance.chroma.dev
VECTOR_STORE_API_KEY=your-chroma-api-key
```

**Setup Steps:**
1. Create account at [ChromaDB Cloud](https://www.trychroma.com/)
2. Create a new database instance
3. Copy your instance URL and API key
4. Add to your `.env` file or your `json` mcp config

### 🐳 ChromaDB Local (Docker)

Run ChromaDB locally using Docker:

```bash
# Basic setup (data lost on removing the container)
docker run -d --name chroma-basic -p 8000:8000 chromadb/chroma

# With persistent storage
docker run -d --name chroma-storage -v ./chroma-data:/data -p 8000:8000 chromadb/chroma
```

```bash
# .env configuration
VECTOR_STORE_TYPE=chroma
VECTOR_STORE_HOST=localhost
VECTOR_STORE_PORT=8000
VECTOR_STORE_URL=http://localhost:8000
```

**Important:** For production deployments, review the [ChromaDB deployment guide](https://docs.trychroma.com/deployment) and [security considerations](https://docs.trychroma.com/deployment#security).

### 🐳 ChromaDB Docker Compose

Add to your `docker-compose.yml`:

```yaml
services:
  chromadb:
    image: chromadb/chroma:latest
    ports:
      - "8000:8000"
    volumes:
      - chroma_data:/chroma/chroma
    environment:
      - IS_PERSISTENT=TRUE
      - PERSIST_DIRECTORY=/chroma/chroma
      - ANONYMIZED_TELEMETRY=FALSE

volumes:
  chroma_data:
```

### ⚙️ ChromaDB Configuration

```bash
# Basic setup
VECTOR_STORE_TYPE=chroma
VECTOR_STORE_URL=http://localhost:8000

# With SSL/TLS
VECTOR_STORE_TYPE=chroma
VECTOR_STORE_HOST=localhost
VECTOR_STORE_PORT=8000
VECTOR_STORE_SSL=true
```

**Distance Metrics:** Cipher automatically converts user-friendly terms:
- `euclidean` → `l2`
- `dot` → `ip` 
- `cosine` → `cosine`

**Compatibility:** Use ChromaDB 1.10.5 for best results. Array fields in metadata are automatically converted to strings.

</details>
<details>
<summary><strong>🔧 Pinecone Configuration</strong></summary>

[Pinecone](https://www.pinecone.io/) is a fully managed vector database service optimized for machine learning applications with excellent performance and scalability.

### ☁️ Pinecone Cloud (Managed)

Pinecone is a cloud-native service that provides serverless vector search:

```bash
# Basic configuration
VECTOR_STORE_TYPE=pinecone
VECTOR_STORE_API_KEY=your-pinecone-api-key
VECTOR_STORE_COLLECTION=your-index-name # Collection names are used as indexes in Pinecone
```

**Setup Steps:**
1. Create account at [Pinecone](https://app.pinecone.io/)
2. Generate an API key from your project settings
3. Choose your preferred region (us-east-1, us-west-2, etc.)
4. Add configuration to your `.env` file or your `json` mcp config

### ⚙️ Pinecone Configuration
Pinecone automatically creates indexes with these settings:

```bash
VECTOR_STORE_TYPE=pinecone
VECTOR_STORE_API_KEY=your-pinecone-api-key
VECTOR_STORE_COLLECTION=your-index-name
PINECONE_NAMESPACE=production   
PINECONE_PROVIDER=aws
PINECONE_REGION=us-east-1
```

**Index Specifications:**
- **Serverless deployment** with automatic scaling
- **Cloud provider**: AWS (default)
- **Region**: us-east-1 (default, configurable)
- **Distance metrics**:
  - Cipher automatically converts user-friendly terms: 
    - `Euclidean` → `euclidean`
    - `Dot` → `dotproduct` 
    - `Cosine` → `cosine`
- **Automatic index creation** if not exists
</details>

<details>
<summary><strong>🔧 PgVector Configuration</strong></summary>

[PgVector](https://github.com/pgvector/pgvector) is a PostgreSQL extension for vector similarity search, combining the reliability of PostgreSQL with vector search capabilities.

### ☁️ Managed PostgreSQL Services

Most cloud PostgreSQL services support pgvector extension:

```bash
# Connection URL format
VECTOR_STORE_TYPE=pgvector
VECTOR_STORE_URL=postgresql://user:pass@host:5432/database

# Or individual parameters 
VECTOR_STORE_TYPE=pgvector
VECTOR_STORE_HOST=your-postgres-host.com
VECTOR_STORE_PORT=5432
PGVECTOR_DATABASE_NAME=vectordb
VECTOR_STORE_USERNAME=your-username
VECTOR_STORE_PASSWORD=your-password
```

### ⚙️ PgVector Configuration

```bash
VECTOR_STORE_TYPE=pgvector
VECTOR_STORE_URL=postgresql://vector_user:vector_pass@localhost:5432/vectordb
VECTOR_STORE_HOST=your-postgres-host.com
VECTOR_STORE_PORT=5432
PGVECTOR_DATABASE_NAME=vectordb
VECTOR_STORE_USERNAME=your-username
VECTOR_STORE_PASSWORD=your-password
VECTOR_STORE_COLLECTION=embeddings  # Used as table name
PGVECTOR_INDEXTYPE=hnsw             # or ivfflat
PGVECTOR_INDEXMETRIC=vector_l2_ops  # vector_ip_ops
VECTOR_STORE_DISTANCE=cosine        # cosine, l2, inner_product
```

**Index Specifications:**
- **Index types**: HNSW (default) for better recall, IVFFlat for speed
- **Distance metrics**: 
  - Cipher automatically converts: `Cosine` → `cosine`, `Euclidean` → `l2`, `Dot` → `inner_product`
- **ACID compliance**: Full PostgreSQL transaction support
- **Automatic table/index creation** if not exists

**Setup Steps:**
1. Install PostgreSQL with pgvector extension
2. Create database and user with appropriate permissions
3. Add configuration to your `.env` file or `json` mcp config
4. Tables and indexes are created automatically on first use

</details>

<details>
<summary><strong>🔧 In-Memory Vector Store</strong></summary>

For development and testing, Cipher includes a built-in in-memory vector store:

```bash
# .env configuration
VECTOR_STORE_TYPE=in-memory
# No additional configuration needed
```

**Features:**
- No external dependencies
- Fast for small datasets
- Data is lost when application restarts
- Perfect for development and testing

</details>

## Configuration Settings
**🛎️ Note**: All the configuration variables below have a default value. By default, only **knowledge memory** is enabled, if you want enable **reflection memory** and **workspace memory**, please set `USE_WORKSPACE_MEMORY=true` and `DISABLE_REFLECTION_MEMORY=false`

<details>
<summary><strong>⚙️ Knowledge and Reflection Collections</strong></summary>

### 📁 Collection Configuration

```bash
# Set the name for knowledge memory collection - default: "knowledge_memory"
VECTOR_STORE_COLLECTION=knowledge_memory

# Vector dimensions (must match your embedding model)
VECTOR_STORE_DIMENSION=1536

# Distance metric for similarity calculations
VECTOR_STORE_DISTANCE=Cosine  # Options: Cosine, Euclidean, Dot (Qdrant/Milvus)
# VECTOR_STORE_DISTANCE=cosine  # Options: cosine, l2, euclidean, ip, dot (ChromaDB)
```

### 🧠 Reflection Memory (Optional)

Cipher supports a separate collection for reflection memory:

```bash
# Set the name for reflection memory collection - default: "reflection_memory"
REFLECTION_VECTOR_STORE_COLLECTION=reflection_memory

# Disable reflection memory entirely
DISABLE_REFLECTION_MEMORY=true  # default: true
```

### ⚡ Performance Settings

```bash
# Maximum number of vectors to store (in-memory only)
VECTOR_STORE_MAX_VECTORS=10000

# Search parameters
VECTOR_STORE_SEARCH_LIMIT=50
VECTOR_STORE_SIMILARITY_THRESHOLD=0.7
```

</details>

<details>
<summary><strong>🏢 Workspace Memory Collections</strong></summary>

When using [workspace memory](./workspace-memory.md), you can configure separate vector store settings:

```bash
# Enable workspace memory
USE_WORKSPACE_MEMORY=true # default: false

# Workspace-specific collection
WORKSPACE_VECTOR_STORE_COLLECTION=workspace_memory

# Use separate vector store for workspace (optional)
WORKSPACE_VECTOR_STORE_TYPE=qdrant  # or: milvus, chroma, in-memory
WORKSPACE_VECTOR_STORE_HOST=localhost
WORKSPACE_VECTOR_STORE_PORT=6333
WORKSPACE_VECTOR_STORE_URL=http://localhost:6333
WORKSPACE_VECTOR_STORE_API_KEY=your-qdrant-api-key

# Workspace search settings
WORKSPACE_SEARCH_THRESHOLD=0.4
WORKSPACE_VECTOR_STORE_DIMENSION=1536
WORKSPACE_VECTOR_STORE_MAX_VECTORS=10000
```

</details>


## Troubleshooting

<details>
<summary><strong>🔧 Common Issues</strong></summary>

### ❌ Dimension Mismatch

**Dimension Error**
```
Error: Vector dimension mismatch
```
**Solution:**
- Check your embedding model dimensions
- Update `VECTOR_STORE_DIMENSION` to match
- Recreate collections if dimensions changed

### 🐌 Performance Issues

**Slow Search Performance**
- Increase `VECTOR_STORE_SEARCH_LIMIT` for more results
- Adjust `VECTOR_STORE_SIMILARITY_THRESHOLD` (lower = more results)
- Consider upgrading to cloud-hosted solutions for better performance

**Memory Usage (In-Memory Store)**
- Reduce `VECTOR_STORE_MAX_VECTORS` if memory is limited
- Switch to external vector store for larger datasets

### 🔧 ChromaDB Issues

**Common Errors:**
- `Cannot find package '@chroma-core/default-embed'` → Use ChromaDB 1.10.5
- `HTTP 422: Unprocessable Entity` → Metadata must be primitive types only
- `Invalid distance metric` → Use `cosine`, `l2`, or `ip` (auto-converted from `euclidean`/`dot`)

</details>

## Related Documentation

- [Configuration](./configuration.md) - Main configuration guide
- [Embedding Configuration](./embedding-configuration.md) - Embedding setup
- [Workspace Memory](./workspace-memory.md) - Team-aware memory system