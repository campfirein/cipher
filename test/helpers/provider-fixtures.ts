/**
 * Test fixture providing a representative ByteRover auth-gate error for
 * mocking daemon responses in CLI command tests. Keyword anchors
 * ('ByteRover account', 'brv login --api-key') are validated by the
 * consuming tests, so the real `BYTEROVER_AUTH_REQUIRED_MESSAGE` in
 * `provider-handler.ts` must always contain those substrings.
 */
export const STUB_BYTEROVER_AUTH_ERROR = [
  'ByteRover Provider requires a ByteRover account.',
  '  • Interactive shell: brv login',
  '  • Headless: brv login --api-key <key>',
].join('\n')
