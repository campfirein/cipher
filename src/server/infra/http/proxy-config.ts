import {ProxyAgent} from 'proxy-agent'

export class ProxyConfig {
  private static agent: ProxyAgent | undefined
  private static initialized = false

  static getProxyAgent(): ProxyAgent | undefined {
    // Only initialize once to reuse connections
    if (!this.initialized) {
      this.initialized = true

      // Determine if a proxy is configured
      const proxyUrl =
        process.env.HTTPS_PROXY ||
        process.env.https_proxy ||
        process.env.HTTP_PROXY ||
        process.env.http_proxy ||
        process.env.ALL_PROXY ||
        process.env.all_proxy

      if (proxyUrl) {
        try {
          // ProxyAgent automatically parses HTTP_PROXY, HTTPS_PROXY and NO_PROXY
          this.agent = new ProxyAgent()
          // Log only in non-production/debug or maybe let it be silent? The original was silent.
          // We will log it explicitly with masked credentials to aid in debugging enterprise issues.
          console.log(`[ByteRover] Initialized Enterprise Proxy Agent: ${this.maskCredentials(proxyUrl)}`)
        } catch (error) {
          // Silently fall back to no proxy if initialization fails
          console.warn(`[ByteRover] Failed to initialize proxy agent:`, error)
        }
      }
    }

    return this.agent
  }

  // Utility to check if proxy is configured
  static isProxyConfigured(): boolean {
    return Boolean(process.env.HTTPS_PROXY ||
      process.env.https_proxy ||
      process.env.HTTP_PROXY ||
      process.env.http_proxy ||
      process.env.ALL_PROXY ||
      process.env.all_proxy)
  }

  // Mask password in proxy URL for safe logging
  private static maskCredentials(url: string): string {
    try {
      const parsed = new URL(url)
      if (parsed.password) {
        parsed.password = '***'
      }

      return parsed.toString()
    } catch {
      return url // If parsing fails, just return the raw string (less secure but handles malformed URLs)
    }
  }
}
