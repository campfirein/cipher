// PROTOCOL.sshsig spec constants. See:
// https://github.com/openssh/openssh-portable/blob/master/PROTOCOL.sshsig
//
// MAGIC_PREAMBLE is `byte[6] "SSHSIG"` (no null terminator) for both the
// envelope and the signed-data structure. The OpenSSH C source uses
// `MAGIC_PREAMBLE_LEN = sizeof("SSHSIG") - 1`, i.e. 6 bytes. Adding the null
// byte produces signatures that fail `ssh-keygen -Y verify` and
// `git verify-commit`.
//
// Exposed as a string literal rather than a shared Buffer because Buffer is
// indexable-mutable — a single misplaced `MAGIC[0] = 0` anywhere in the
// process would silently corrupt every signature thereafter. Each caller
// converts to its own Buffer at module load.
export const SSHSIG_MAGIC_PREAMBLE = 'SSHSIG'
