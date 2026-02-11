import type {ConnectorType} from '../../../../shared/types/connector-type.js'

export const getConnectorName = (type: ConnectorType): string => {
  switch (type) {
    case 'hook': {
      return 'Hook'
    }

    case 'mcp': {
      return 'MCP'
    }

    case 'rules': {
      return 'Rules'
    }

    case 'skill': {
      return 'Agent Skill'
    }
  }
}
