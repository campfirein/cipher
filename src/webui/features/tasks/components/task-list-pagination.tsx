import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from '@campfirein/byterover-packages/components/pagination'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@campfirein/byterover-packages/components/select'
import {cn} from '@campfirein/byterover-packages/lib/utils'

const PAGE_SIZE_OPTIONS = [50, 100, 250] as const

export interface TaskListPaginationProps {
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  page: number
  pageCount: number
  pageSize: number
  total: number
}

export function TaskListPagination({
  onPageChange,
  onPageSizeChange,
  page,
  pageCount,
  pageSize,
  total,
}: TaskListPaginationProps) {
  if (pageCount <= 1 && total <= PAGE_SIZE_OPTIONS[0]) return null

  const pages = pageNumbersToShow(page, pageCount)
  const isFirst = page <= 1
  const isLast = page >= pageCount

  return (
    <div className="flex items-center justify-between gap-3 px-1">
      <span className="text-muted-foreground text-xs">
        {total > 0 ? `${total} task${total === 1 ? '' : 's'}` : 'No tasks'}
      </span>
      {pageCount > 1 && (
        <Pagination className="mx-0 w-auto">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                aria-disabled={isFirst}
                className={cn({'pointer-events-none opacity-50': isFirst})}
                onClick={() => !isFirst && onPageChange(page - 1)}
              />
            </PaginationItem>
            {pages.map((entry, idx) =>
              entry === 'ellipsis' ? (
                <PaginationItem key={`ellipsis-${idx}`}>
                  <PaginationEllipsis />
                </PaginationItem>
              ) : (
                <PaginationItem key={entry}>
                  <PaginationLink isActive={entry === page} onClick={() => onPageChange(entry)}>
                    {entry}
                  </PaginationLink>
                </PaginationItem>
              ),
            )}
            <PaginationItem>
              <PaginationNext
                aria-disabled={isLast}
                className={cn({'pointer-events-none opacity-50': isLast})}
                onClick={() => !isLast && onPageChange(page + 1)}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
      <Select onValueChange={(value) => onPageSizeChange(Number(value))} value={String(pageSize)}>
        <SelectTrigger className="h-8 text-xs" size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PAGE_SIZE_OPTIONS.map((option) => (
            <SelectItem key={option} value={String(option)}>
              {option} / page
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function pageNumbersToShow(current: number, total: number): Array<'ellipsis' | number> {
  if (total <= 7) {
    return Array.from({length: total}, (_, i) => i + 1)
  }

  const result: Array<'ellipsis' | number> = [1]
  const left = Math.max(2, current - 1)
  const right = Math.min(total - 1, current + 1)

  if (left > 2) result.push('ellipsis')
  for (let i = left; i <= right; i++) result.push(i)
  if (right < total - 1) result.push('ellipsis')

  result.push(total)
  return result
}
