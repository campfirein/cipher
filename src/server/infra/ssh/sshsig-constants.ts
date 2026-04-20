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
