import Connectors from './index.js'

export default class ConnectorsList extends Connectors {
  public static description = 'List installed agent connectors'
  public static examples = [
    '<%= config.bin %> connectors list',
    '<%= config.bin %> connectors list --format json',
  ]
}
