import type {Agent} from '../../../../shared/types/agent'

import amp from '../../../assets/connectors/amp-connector.svg'
import antigravity from '../../../assets/connectors/antigravity-connector.svg'
import auggie from '../../../assets/connectors/auggie-connector.svg'
import augment from '../../../assets/connectors/augment-connector.svg'
import claude from '../../../assets/connectors/claude-connector.svg'
import cline from '../../../assets/connectors/cline-connector.svg'
import codex from '../../../assets/connectors/codex-connector.svg'
import cursor from '../../../assets/connectors/cursor-connector.svg'
import gemini from '../../../assets/connectors/gemini-connector.svg'
import githubCopilot from '../../../assets/connectors/githubcopilot-connector.svg'
import junie from '../../../assets/connectors/junie-connector.svg'
import kilocode from '../../../assets/connectors/kilocode-connector.svg'
import kiro from '../../../assets/connectors/kiro-connector.svg'
import openclaw from '../../../assets/connectors/openclaw-connector.svg'
import opencode from '../../../assets/connectors/opencode-connector.svg'
import qoder from '../../../assets/connectors/qoder-connector.svg'
import qwen from '../../../assets/connectors/qwen-connector.svg'
import roocode from '../../../assets/connectors/roocode-connector.svg'
import trae from '../../../assets/connectors/trae-connector.svg'
import warp from '../../../assets/connectors/warp-connector.svg'
import windsurf from '../../../assets/connectors/windsurf-connector.svg'
import zed from '../../../assets/connectors/zed-connector.svg'

/** Maps agent name to its icon SVG path. */
export const agentIcons: Partial<Record<Agent, string>> = {
  'Amp': amp,
  'Antigravity': antigravity,
  'Auggie CLI': auggie,
  'Augment Code': augment,
  'Claude Code': claude,
  'Cline': cline,
  'Codex': codex,
  'Cursor': cursor,
  'Gemini CLI': gemini,
  'Github Copilot': githubCopilot,
  'Junie': junie,
  'Kilo Code': kilocode,
  'Kiro': kiro,
  'OpenClaw': openclaw,
  'OpenCode': opencode,
  'Qoder': qoder,
  'Qwen Code': qwen,
  'Roo Code': roocode,
  'Trae.ai': trae,
  'Warp': warp,
  'Windsurf': windsurf,
  'Zed': zed,
}
