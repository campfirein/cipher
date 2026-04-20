// PROTOCOL.sshsig spec constants. See:
// https://github.com/openssh/openssh-portable/blob/master/PROTOCOL.sshsig
//
// MAGIC_PREAMBLE is `byte[6] "SSHSIG"` (no null terminator) for both the
// envelope and the signed-data structure. Adding a null byte produces
// signatures that fail `ssh-keygen -Y verify` and `git verify-commit`.
//
// Exported as a string rather than a Buffer so the spec value cannot be
// mutated across module boundaries — Buffer is indexable-mutable. Each
// importing module materialises its own module-private Buffer once at load.
export const SSHSIG_MAGIC_PREAMBLE = 'SSHSIG'

// Hash algorithm embedded in the sshsig signed-data structure. Fixed at
// `sha512`, not configurable, for three reasons:
//
//   1. Ed25519 (our primary supported key type) MANDATES SHA-512 as part of
//      the EdDSA algorithm itself — there is no other choice.
//   2. RSA signing via ssh-agent uses the `RSA-SHA2-512` agent flag
//      (see ssh-agent-signer.ts). OpenSSH's default.
//   3. Every OpenSSH verifier from 2017 onwards accepts sha512-labelled
//      sshsig signatures; there is no consumer-compat benefit to offering
//      sha256 as an alternative.
//
// If a future key type or verifier needs sha256, thread this constant
// through signCommitPayload / SshAgentSigner.sign as a parameter — do not
// re-hardcode in each signer.
export const SSHSIG_HASH_ALGORITHM = 'sha512'
