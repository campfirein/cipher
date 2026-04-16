// All implementations have moved to src/shared/ssh/key-parser.ts.
// Re-export everything so existing server imports (ssh-agent-signer, vc-handler, etc.) continue to work.
export {
  computeFingerprint,
  getPublicKeyMetadata,
  parseSSHPrivateKey,
  probeSSHKey,
  resolveHome,
} from '../../../shared/ssh/key-parser.js'
