import {useState} from 'react'

import {useTransportStore} from '../stores/transport-store'

interface StatusDTO {
  authStatus: 'expired' | 'logged_in' | 'not_logged_in' | 'unknown'
  contextTreeStatus: 'has_changes' | 'no_changes' | 'not_initialized' | 'unknown'
  currentDirectory: string
  spaceName?: string
  teamName?: string
  userEmail?: string
}

interface StatusGetResponse {
  status: StatusDTO
}

interface SpaceDTO {
  id: string
  isDefault: boolean
  name: string
  teamId: string
  teamName: string
}

interface TeamWithSpacesDTO {
  spaces: SpaceDTO[]
  teamId: string
  teamName: string
}

interface SpaceListResponse {
  teams: TeamWithSpacesDTO[]
}

export function HomePage() {
  const {apiClient, connectionState, isConnected} = useTransportStore()
  const [status, setStatus] = useState<null | StatusDTO>(null)
  const [teams, setTeams] = useState<TeamWithSpacesDTO[]>([])
  const [loadingStatus, setLoadingStatus] = useState(false)
  const [loadingSpaces, setLoadingSpaces] = useState(false)
  const [error, setError] = useState<null | string>(null)

  async function handleFetchStatus() {
    if (!apiClient) return
    setLoadingStatus(true)
    setError(null)
    try {
      const response = await apiClient.request<StatusGetResponse>('status:get')
      setStatus(response.status)
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : String(error_))
    } finally {
      setLoadingStatus(false)
    }
  }

  async function handleFetchSpaces() {
    if (!apiClient) return
    setLoadingSpaces(true)
    setError(null)
    try {
      const response = await apiClient.request<SpaceListResponse>('space:list')
      setTeams(response.teams)
    } catch (error_) {
      setError(error_ instanceof Error ? error_.message : String(error_))
    } finally {
      setLoadingSpaces(false)
    }
  }

  return (
    <div style={{padding: '2rem'}}>
      <h1>ByteRover</h1>

      {connectionState === 'disconnected' && (
        <div style={{background: '#fee2e2', borderRadius: '4px', color: '#991b1b', marginBottom: '1rem', padding: '0.75rem'}}>
          Connection lost. Run <code>brv ui</code> to reconnect.
        </div>
      )}

      {connectionState === 'reconnecting' && (
        <div style={{background: '#fef3c7', borderRadius: '4px', color: '#92400e', marginBottom: '1rem', padding: '0.75rem'}}>
          Reconnecting...
        </div>
      )}

      {connectionState === 'connected' && (
        <div style={{background: '#d1fae5', borderRadius: '4px', color: '#065f46', marginBottom: '1rem', padding: '0.75rem'}}>
          Connected
        </div>
      )}

      <div style={{display: 'flex', gap: '0.5rem', marginTop: '1rem'}}>
        <button disabled={!isConnected || loadingStatus} onClick={handleFetchStatus}>
          {loadingStatus ? 'Loading...' : 'Fetch Status'}
        </button>
        <button disabled={!isConnected || loadingSpaces} onClick={handleFetchSpaces}>
          {loadingSpaces ? 'Loading...' : 'Fetch Spaces'}
        </button>
      </div>

      {error && <p style={{color: 'red'}}>{error}</p>}

      {status && (
        <div style={{marginTop: '1rem'}}>
          <h3>Status</h3>
          <p>Directory: {status.currentDirectory}</p>
          <p>Auth: {status.authStatus}{status.userEmail ? ` (${status.userEmail})` : ''}</p>
          <p>Context Tree: {status.contextTreeStatus}</p>
          {status.teamName && status.spaceName && (
            <p>Space: {status.teamName}/{status.spaceName}</p>
          )}
        </div>
      )}

      {teams.length > 0 && (
        <div style={{marginTop: '1rem'}}>
          <h3>Spaces</h3>
          {teams.map((team) => (
            <div key={team.teamId} style={{marginBottom: '0.5rem'}}>
              <strong>{team.teamName}</strong>
              <ul>
                {team.spaces.map((space) => (
                  <li key={space.id}>
                    {space.name} {space.isDefault && '(default)'}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
