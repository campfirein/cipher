import {ProxyAgent} from 'proxy-agent'

import {processLog} from "../../utils/process-logger.js";

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
          this.agent = new ProxyAgent()
          processLog(`[ByteRover] Initialized Enterprise Proxy Agent: ${this.maskCredentials(proxyUrl)}`)
        } catch (error) {
          // Silently fall back to no proxy if initialization fails
          processLog(`[ByteRover] Failed to initialize proxy agent: ${error instanceof Error ? error.message: String(error)}`)
        }
      }
    }

    return this.agent
  }

  /**
   * Utility to check if proxy is configured
   */
  static isProxyConfigured(): boolean {
    return Boolean(process.env.HTTPS_PROXY ||
      process.env.https_proxy ||
      process.env.HTTP_PROXY ||
      process.env.http_proxy ||
      process.env.ALL_PROXY ||
      process.env.all_proxy)
  }

  /**
   * Masks password in proxy URL for safe logging
   * @param url proxy URL
   * @private
   */
  private static maskCredentials(url: string): string {
    try {
      const parsed = new URL(url)
      if (parsed.password) {
        parsed.password = '***'
      }

      return parsed.toString()
    } catch {
      return '[unparseable proxy URL]'
    }
  }
}
