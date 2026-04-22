type BuildRemoteSpaceUrlInput = {
  spaceName: string | undefined
  teamName: string | undefined
  webAppUrl: string | undefined
}

export function buildRemoteSpaceUrl({spaceName, teamName, webAppUrl}: BuildRemoteSpaceUrlInput): string | undefined {
  if (!teamName || !spaceName || !webAppUrl) return undefined
  const base = webAppUrl.replace(/\/+$/, '')
  return `${base}/${encodeURIComponent(teamName)}/${encodeURIComponent(spaceName)}`
}
