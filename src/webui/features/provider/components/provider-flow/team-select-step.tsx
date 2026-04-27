import {Badge} from '@campfirein/byterover-packages/components/badge'
import {Button} from '@campfirein/byterover-packages/components/button'
import {DialogDescription, DialogHeader, DialogTitle} from '@campfirein/byterover-packages/components/dialog'
import {Skeleton} from '@campfirein/byterover-packages/components/skeleton'
import {cn} from '@campfirein/byterover-packages/lib/utils'
import {Building2, Check, ChevronLeft, LoaderCircle} from 'lucide-react'
import {ReactNode, useState} from 'react'
import {toast} from 'sonner'

import type {BillingTier, TeamDTO} from '../../../../../shared/transport/types/dto'

import {formatError} from '../../../../lib/error-messages'
import {initials} from '../../../../utils/initials'
import {useAuthStore} from '../../../auth/stores/auth-store'
import {useGetPinnedOrganization} from '../../api/get-pinned-organization'
import {useListBillingUsage} from '../../api/list-billing-usage'
import {useListTeams} from '../../api/list-teams'
import {useSetPinnedOrganization} from '../../api/set-pinned-organization'
import {getBillingTone} from '../../utils/get-billing-tone'
import {CreditsPill} from '../credits-pill'

const WORKSPACE_DEFAULT_VALUE = '__workspace_default__' as const

interface TeamSelectStepProps {
  onBack: () => void
  onComplete: () => void
}

function TeamRow({
  avatar,
  badges,
  credits,
  meta,
  name,
  onSelect,
  selected,
}: {
  avatar: ReactNode
  badges?: ReactNode
  credits?: ReactNode
  meta?: string
  name: string
  onSelect: () => void
  selected: boolean
}) {
  return (
    <button
      className={cn(
        'group/row flex w-full cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
        selected ? 'border-primary-foreground/40 bg-primary/5' : 'border-border hover:border-foreground/25',
      )}
      onClick={onSelect}
      type="button"
    >
      {avatar}
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="text-foreground flex flex-wrap items-center gap-1.5 text-sm">
          <span className="font-medium truncate">{name}</span>
          {badges}
        </div>
        {meta && <div className="text-muted-foreground min-h-lh truncate text-xs">{meta}</div>}
      </div>
      {credits}
      <div
        className={cn(
          'grid size-[18px] shrink-0 place-items-center rounded-full border transition-colors',
          selected ? 'bg-primary-foreground border-primary-foreground' : 'border-border',
        )}
      >
        {selected && <Check className="text-background size-3" strokeWidth={3} />}
      </div>
    </button>
  )
}

function TeamAvatar({avatarUrl, name}: {avatarUrl?: string; name: string}) {
  return (
    <div className="bg-muted/50 grid size-7 shrink-0 place-items-center overflow-hidden rounded-md">
      {avatarUrl ? (
        <img alt="" className="size-full object-cover" src={avatarUrl} />
      ) : (
        <span className="text-muted-foreground text-[10px] font-medium">{initials(name)}</span>
      )}
    </div>
  )
}

const TIER_LABEL: Record<BillingTier, string> = {
  FREE: 'Free',
  PRO: 'Pro',
  TEAM: 'Team',
}

const TIER_BADGE_CLASS: Record<BillingTier, string> = {
  FREE: 'border-gray-700 bg-gray-900 text-gray-300',
  PRO: 'border-orange-800 bg-orange-950 text-orange-400',
  TEAM: 'border-blue-800 bg-blue-950 text-blue-400',
}

function RowBadge({children, className}: {children: ReactNode; className?: string}) {
  return (
    <Badge
      className={cn(
        'h-[18px] rounded-sm px-1.5 text-[11px] font-medium leading-none',
        className ?? 'border-primary-foreground/40 bg-primary-foreground/15 text-primary-foreground',
      )}
      variant="outline"
    >
      {children}
    </Badge>
  )
}

function TierBadge({isTrialing, tier}: {isTrialing: boolean; tier: BillingTier}) {
  return (
    <RowBadge className={TIER_BADGE_CLASS[tier]}>
      {TIER_LABEL[tier]}
      {isTrialing ? ' · trial' : ''}
    </RowBadge>
  )
}

export function TeamSelectStep({onBack, onComplete}: TeamSelectStepProps) {
  const workspaceTeamId = useAuthStore((s) => s.brvConfig?.teamId)
  const workspaceTeamName = useAuthStore((s) => s.brvConfig?.teamName)

  const {data: teamsData, error: teamsError, isLoading: teamsLoading} = useListTeams()
  const {data: pinnedData, isLoading: pinnedLoading} = useGetPinnedOrganization()
  const setPinned = useSetPinnedOrganization()

  const teams: TeamDTO[] = teamsData?.teams ?? []
  const {data: usageData} = useListBillingUsage()
  const usageByTeam = usageData?.usage ?? {}

  const pinnedOrganizationId = pinnedData?.organizationId
  const initialSelection = pinnedOrganizationId ?? WORKSPACE_DEFAULT_VALUE
  const [selection, setSelection] = useState<string>(initialSelection)

  const isPersisting = setPinned.isPending
  const isLoading = teamsLoading || pinnedLoading
  const dirty = selection !== initialSelection
  const canConfirm = dirty && !isPersisting

  async function confirm() {
    const next = selection === WORKSPACE_DEFAULT_VALUE ? undefined : selection
    try {
      const result = await setPinned.mutateAsync(next)
      if (!result.success) {
        toast.error(result.error ?? 'Failed to update billing team.')
        return
      }

      toast.success(next ? 'Billing team changed.' : 'Reverted to workspace default.')
      onComplete()
    } catch (error) {
      toast.error(formatError(error, 'Failed to update billing team.'))
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      <DialogHeader>
        <button
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 self-start text-xs"
          onClick={onBack}
          type="button"
        >
          <ChevronLeft className="size-3" /> Back
        </button>
        <DialogTitle>Pick a team to bill</DialogTitle>
        <DialogDescription>
          ByteRover credits are charged to a team. Pick a default, or follow the workspace.
        </DialogDescription>
      </DialogHeader>

      {teamsError ? (
        <p className="text-destructive text-sm">{formatError(teamsError, 'Failed to load teams.')}</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-4 -mr-4 [scrollbar-gutter:stable]">
          <TeamRow
            avatar={
              <div className="bg-muted/50 grid size-7 shrink-0 place-items-center overflow-hidden rounded-md">
                <Building2 className="text-muted-foreground size-4" />
              </div>
            }
            meta={
              workspaceTeamName ? `Resolves per workspace · today: ${workspaceTeamName}` : 'Resolves per workspace.'
            }
            name="Use workspace default"
            onSelect={() => setSelection(WORKSPACE_DEFAULT_VALUE)}
            selected={selection === WORKSPACE_DEFAULT_VALUE}
          />

          {isLoading && teams.length === 0 ? (
            <>
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </>
          ) : (
            teams.map((team) => {
              const teamUsage = usageByTeam[team.id]
              const roleLabel = team.id === workspaceTeamId ? 'Workspace' : team.isDefault ? 'Default' : undefined
              return (
                <TeamRow
                  avatar={<TeamAvatar avatarUrl={team.avatarUrl} name={team.displayName} />}
                  badges={
                    <>
                      {teamUsage && <TierBadge isTrialing={teamUsage.isTrialing} tier={teamUsage.tier} />}
                      {roleLabel && <RowBadge>{roleLabel}</RowBadge>}
                    </>
                  }
                  credits={<CreditsPill tone={getBillingTone(teamUsage)} usage={teamUsage} />}
                  key={team.id}
                  name={team.displayName}
                  onSelect={() => setSelection(team.id)}
                  selected={selection === team.id}
                />
              )
            })
          )}
        </div>
      )}

      <div className="border-border flex items-center justify-end gap-2 border-t pt-3">
        <Button disabled={isPersisting} onClick={onComplete} variant="ghost">
          Skip
        </Button>
        <Button disabled={!canConfirm} onClick={() => confirm()}>
          {isPersisting ? <LoaderCircle className="size-4 animate-spin" /> : 'Confirm'}
        </Button>
      </div>
    </div>
  )
}
