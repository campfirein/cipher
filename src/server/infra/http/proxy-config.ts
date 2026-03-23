import {ProxyAgent} from 'proxy-agent'

export class ProxyConfig {
  private static agent: ProxyAgent | undefined

  public static getProxyAgent(): ProxyAgent {
    if (!this.agent) {
      this.agent = new ProxyAgent()
    }

    return this.agent
  }
}
