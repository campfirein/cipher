# Deploying Cipher Behind Nginx Reverse Proxy

This guide explains how to deploy Cipher's MCP server behind an Nginx reverse proxy with a custom context path (e.g., `/agent/`).

## Problem Overview

When deploying Cipher behind a reverse proxy like Nginx with a context path, MCP SSE (Server-Sent Events) connections may fail due to:

1. **Endpoint Path Mismatch**: The SSE transport may not include the proxy context path
2. **Missing Session IDs**: Query parameters or headers may be stripped by the proxy
3. **CORS Issues**: Cross-origin requests may be blocked
4. **Header Forwarding**: Proxy headers may not be properly forwarded to the application

## Solution: Proper Configuration

### 1. Nginx Configuration

Create or update your Nginx configuration to properly proxy requests to Cipher:

```nginx
# Nginx configuration for Cipher MCP server
location /agent/ {
    # Proxy to Cipher container/service
    proxy_pass http://cipher-api:3000/;

    # Essential headers for reverse proxy support
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;

    # CRITICAL: Pass the context path to the application
    proxy_set_header X-Forwarded-Prefix /agent;

    # SSE specific settings (required for MCP SSE transport)
    proxy_http_version 1.1;
    proxy_set_header Connection '';
    proxy_buffering off;
    proxy_cache off;
    chunked_transfer_encoding off;

    # Timeouts for long-lived SSE connections
    proxy_read_timeout 300s;
    proxy_connect_timeout 75s;
    proxy_send_timeout 300s;

    # WebSocket support (optional, if using WebSocket mode)
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}

# Optional: Health check endpoint without context path
location /health {
    proxy_pass http://cipher-api:3000/health;
    proxy_set_header Host $host;
}
```

#### Key Configuration Points:

- **`proxy_pass http://cipher-api:3000/`**: Points to your Cipher service (note the trailing slash)
- **`X-Forwarded-Prefix`**: Tells Cipher the context path (`/agent`)
- **`proxy_buffering off`**: Critical for SSE to work properly
- **`proxy_http_version 1.1`**: Required for SSE and WebSocket
- **Long timeouts**: MCP connections can be long-lived

### 2. Cipher Configuration

#### Environment Variables

Set the `PROXY_CONTEXT_PATH` environment variable to match your nginx context path:

**Using Docker Compose:**

```yaml
services:
  cipher-api:
    build: .
    image: cipher-api
    ports:
      - '3000:3000'
    environment:
      - CIPHER_API_PREFIX=""  # Keep empty for direct access
      - PROXY_CONTEXT_PATH=/agent  # Must match nginx location
      - NODE_ENV=production
    env_file:
      - .env
    command:
      [
        'sh',
        '-c',
        'node dist/src/app/index.cjs --mode api --port 3000 --host 0.0.0.0 --agent /app/memAgent/cipher.yml --mcp-transport-type sse',
      ]
    volumes:
      - ./memAgent:/app/memAgent:ro
      - cipher-data:/app/.cipher
    restart: unless-stopped
```

**Using `.env` file:**

```bash
# Reverse Proxy Configuration
PROXY_CONTEXT_PATH=/agent

# API Configuration
CIPHER_API_PREFIX=""

# Other settings
NODE_ENV=production
```

**Using CLI:**

```bash
PROXY_CONTEXT_PATH=/agent cipher --mode api --port 3000 --mcp-transport-type sse
```

### 3. Client Configuration

Update your MCP client configuration to use the full proxied URL:

**VSCode MCP Settings:**

```json
{
  "mcpServers": {
    "cipher": {
      "transport": "sse",
      "url": "https://tools.dev-bg.in/agent/mcp/sse"
    }
  }
}
```

**Claude Desktop MCP Settings:**

```json
{
  "mcpServers": {
    "cipher": {
      "command": "node",
      "args": ["mcp-client.js"],
      "env": {
        "CIPHER_URL": "https://tools.dev-bg.in/agent/mcp/sse"
      }
    }
  }
}
```

## How It Works

### Request Flow

1. **Client connects**: `GET https://tools.dev-bg.in/agent/mcp/sse`
2. **Nginx receives**: Adds `X-Forwarded-Prefix: /agent` header
3. **Cipher processes**:
   - Reads `X-Forwarded-Prefix` or `PROXY_CONTEXT_PATH`
   - Creates SSE transport with endpoint: `/agent/mcp`
   - Returns SSE stream with correct POST endpoint
4. **Client receives**: POST endpoint URL `https://tools.dev-bg.in/agent/mcp?sessionId=...`
5. **Client sends messages**: `POST https://tools.dev-bg.in/agent/mcp?sessionId=xyz`
6. **Nginx proxies**: Request reaches Cipher with session ID
7. **Cipher routes**: Finds active SSE session and handles message

### Session ID Resolution

Cipher supports multiple methods to pass session IDs (in order of precedence):

1. **Query Parameter**: `?sessionId=xyz` (recommended)
2. **HTTP Header**: `X-Session-ID: xyz`
3. **Request Body**: `{ "sessionId": "xyz", ... }`
4. **Fallback**: If only one active session exists, it's used automatically

## Troubleshooting

### Issue: 401 Unauthorized

**Cause**: CORS or authentication issues

**Solution**:
```nginx
# Add CORS headers if needed
add_header 'Access-Control-Allow-Origin' '$http_origin' always;
add_header 'Access-Control-Allow-Methods' 'GET, POST, OPTIONS' always;
add_header 'Access-Control-Allow-Headers' 'Content-Type, Authorization, X-Session-ID' always;
add_header 'Access-Control-Allow-Credentials' 'true' always;

# Handle preflight requests
if ($request_method = 'OPTIONS') {
    return 204;
}
```

### Issue: SSE Connection Timeout

**Cause**: Nginx buffering or timeout settings

**Solution**:
```nginx
# Increase timeouts
proxy_read_timeout 600s;
proxy_send_timeout 600s;

# Ensure buffering is off
proxy_buffering off;
proxy_cache off;
```

### Issue: Session ID Not Found

**Symptoms**:
```
Error: No active session found for ID: xyz
```

**Troubleshooting Steps**:

1. Check logs for session creation:
   ```bash
   docker logs cipher-api | grep "SSE session created"
   ```

2. Verify session ID in request:
   ```bash
   # Enable debug logging
   NODE_ENV=development PROXY_CONTEXT_PATH=/agent cipher --mode api
   ```

3. Check if query parameters are preserved:
   ```nginx
   # Add to nginx config for debugging
   add_header X-Debug-Query $args always;
   ```

### Issue: Wrong Endpoint URL

**Symptoms**: Client POSTs to `/mcp` instead of `/agent/mcp`

**Solution**: Ensure both configurations are set:

1. Nginx: `proxy_set_header X-Forwarded-Prefix /agent;`
2. Cipher: `PROXY_CONTEXT_PATH=/agent`

Check logs for:
```
[API Server] Creating SSE transport with POST endpoint: /agent/mcp
[API Server] Client should POST to: /agent/mcp?sessionId=xyz
```

## Testing

### 1. Test Direct Access

```bash
# Without proxy
curl -N http://localhost:3000/mcp/sse
```

### 2. Test Through Nginx

```bash
# Through proxy
curl -N -H "X-Forwarded-Prefix: /agent" \
     -H "X-Forwarded-Proto: https" \
     -H "X-Forwarded-Host: tools.dev-bg.in" \
     https://tools.dev-bg.in/agent/mcp/sse
```

### 3. Test Health Check

```bash
# Direct
curl http://localhost:3000/health

# Through proxy
curl https://tools.dev-bg.in/agent/health
```

### 4. Test Session POST

```bash
# Get session ID from SSE stream first, then:
curl -X POST "https://tools.dev-bg.in/agent/mcp?sessionId=YOUR_SESSION_ID" \
     -H "Content-Type: application/json" \
     -d '{
       "jsonrpc": "2.0",
       "id": 1,
       "method": "initialize",
       "params": {}
     }'
```

## Complete Example Setup

### docker-compose.yml

```yaml
version: '3.8'

services:
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
      - ./ssl:/etc/nginx/ssl:ro
    depends_on:
      - cipher-api
    restart: unless-stopped

  cipher-api:
    build: .
    image: cipher-api
    expose:
      - "3000"
    environment:
      - CIPHER_API_PREFIX=""
      - PROXY_CONTEXT_PATH=/agent
      - NODE_ENV=production
    env_file:
      - .env
    command:
      [
        'sh',
        '-c',
        'node dist/src/app/index.cjs --mode api --port 3000 --host 0.0.0.0 --agent /app/memAgent/cipher.yml --mcp-transport-type sse',
      ]
    volumes:
      - ./memAgent:/app/memAgent:ro
      - cipher-data:/app/.cipher
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--no-verbose", "--tries=1", "--spider", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

volumes:
  cipher-data:
```

### nginx.conf

```nginx
upstream cipher {
    server cipher-api:3000;
}

server {
    listen 80;
    server_name tools.dev-bg.in;

    # Redirect to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name tools.dev-bg.in;

    # SSL configuration
    ssl_certificate /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Logging
    access_log /var/log/nginx/cipher-access.log;
    error_log /var/log/nginx/cipher-error.log;

    # Cipher MCP endpoints
    location /agent/ {
        proxy_pass http://cipher/;

        # Proxy headers
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Prefix /agent;

        # SSE settings
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding off;

        # Timeouts
        proxy_read_timeout 300s;
        proxy_connect_timeout 75s;
        proxy_send_timeout 300s;

        # WebSocket support
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }

    # Health check
    location /health {
        proxy_pass http://cipher/health;
        proxy_set_header Host $host;
    }
}
```

## Advanced Configuration

### Multiple Instances with Load Balancing

```nginx
upstream cipher_cluster {
    # Session affinity required for SSE
    ip_hash;

    server cipher-api-1:3000 max_fails=3 fail_timeout=30s;
    server cipher-api-2:3000 max_fails=3 fail_timeout=30s;
    server cipher-api-3:3000 max_fails=3 fail_timeout=30s;
}

location /agent/ {
    proxy_pass http://cipher_cluster/;
    # ... rest of configuration
}
```

### SSL/TLS Termination

```nginx
server {
    listen 443 ssl http2;

    # Modern SSL configuration
    ssl_certificate /etc/nginx/ssl/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256';
    ssl_prefer_server_ciphers off;

    # HSTS
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # ... rest of configuration
}
```

## Security Considerations

### 1. Always Use HTTPS in Production

```nginx
server {
    listen 443 ssl http2;
    server_name tools.dev-bg.in;

    ssl_certificate /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;
    # ... rest of config
}
```

### 2. Configure CORS Properly

**IMPORTANT**: Cipher's CORS configuration requires explicit origin whitelisting for security.

When running behind a reverse proxy, you must configure allowed origins in your environment:

```yaml
# docker-compose.yml or environment variables
environment:
  - CIPHER_CORS_ORIGINS=https://your-domain.com,https://app.your-domain.com
```

Or via CLI:
```bash
cipher --mode api --cors-origins "https://your-domain.com,https://app.your-domain.com"
```

**Default Behavior**:
- **Production** (`NODE_ENV=production`): Only explicitly allowed origins are accepted
- **Development** (`NODE_ENV=development`): Localhost origins are automatically allowed for convenience
- **No origin header**: Always allowed (for non-browser clients like curl, Postman, mobile apps)

**Security Note**: Setting `trust proxy` does NOT bypass CORS. The `trust proxy` setting only affects how Express reads X-Forwarded headers to determine the client's real IP and protocol.

### 3. Enable Rate Limiting

```nginx
limit_req_zone $binary_remote_addr zone=mcp_limit:10m rate=10r/s;

location /agent/mcp {
    limit_req zone=mcp_limit burst=20 nodelay;
    # ... rest of configuration
}
```

### 4. Implement Authentication

Consider adding authentication at the nginx level or application level:

```nginx
location /agent/ {
    # Basic auth
    auth_basic "Restricted Access";
    auth_basic_user_file /etc/nginx/.htpasswd;

    # Or use API key validation
    if ($http_x_api_key != "your-secret-key") {
        return 401;
    }

    proxy_pass http://cipher/;
    # ... rest of config
}
```

### 5. Monitor Logs

```bash
# Watch for suspicious activity
tail -f /var/log/nginx/cipher-access.log | grep "mcp/sse"

# Monitor Cipher application logs
docker logs -f cipher-api | grep "SSE"
```

### 6. Keep Timeouts Reasonable

```nginx
# Balance between long-lived connections and resource exhaustion
proxy_read_timeout 300s;  # 5 minutes
proxy_connect_timeout 75s;
proxy_send_timeout 300s;
```

## Monitoring

### Nginx Access Logs

```bash
tail -f /var/log/nginx/cipher-access.log | grep "mcp/sse"
```

### Cipher Application Logs

```bash
docker logs -f cipher-api | grep "SSE"
```

### Health Monitoring

```bash
# Add to cron or monitoring system
*/5 * * * * curl -f https://tools.dev-bg.in/agent/health || alert
```

## Summary

To successfully deploy Cipher behind Nginx:

1. ✅ Configure Nginx with proper headers and SSE settings
2. ✅ Set `X-Forwarded-Prefix` header in Nginx
3. ✅ Set `PROXY_CONTEXT_PATH` environment variable in Cipher
4. ✅ Update client configuration with full proxied URL
5. ✅ Test SSE connection and POST endpoints
6. ✅ Monitor logs for proper session handling
7. ✅ Implement security best practices

For additional help, see:
- [MCP Integration Guide](./mcp-integration.md)
- [Configuration Reference](./configuration.md)
- [GitHub Issues](https://github.com/campfirein/cipher/issues)
