/**
 * Builds the ByteRover web-app URL where a user can top up credits for the
 * given team. Returns undefined when either input is missing so the caller
 * can hide the CTA instead of opening a broken link.
 */
export function buildTopUpUrl({
  teamName,
  webAppUrl,
}: {
  teamName?: string
  webAppUrl?: string
}): string | undefined {
  if (!teamName || !webAppUrl) return undefined
  const base = webAppUrl.replace(/\/+$/, '')
  return `${base}/settings/${teamName}/billing`
}
