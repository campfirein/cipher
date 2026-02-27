import type {ConnectorType} from '../../../../shared/types/connector-type.js'

export const getConnectorDescription = (type: ConnectorType): string => {
  switch (type) {
    case 'hook': {
      return 'Instructions injected on each prompt'
    }

    case 'mcp': {
      return 'Agent connects via MCP protocol'
    }

    case 'rules': {
      return 'Agent reads instructions from rule file'
    }

    case 'skill': {
      return 'Agent reads skill files from project directory'
    }
  }
}

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
