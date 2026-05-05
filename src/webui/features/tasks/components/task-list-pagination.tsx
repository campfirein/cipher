import {
  Pagination,
  PaginationContent,
  PaginationFirst,
  PaginationItem,
  PaginationLast,
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

const PAGE_SIZE_OPTIONS = [20, 50, 100] as const

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

  const canPrev = page > 1
  const canNext = page < pageCount

  return (
    <Pagination className="mx-0 w-auto">
      <PaginationContent>
        <PaginationItem>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-sm">Rows per page</span>
            <Select onValueChange={(value) => onPageSizeChange(Number(value))} value={String(pageSize)}>
              <SelectTrigger className="h-8 text-xs" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZE_OPTIONS.map((option) => (
                  <SelectItem key={option} value={String(option)}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </PaginationItem>
        <PaginationItem>
          <span className="text-muted-foreground px-2 text-sm">
            Page {page} of {Math.max(pageCount, 1)}
          </span>
        </PaginationItem>
        <PaginationItem>
          <PaginationFirst
            aria-disabled={!canPrev}
            className={cn({'pointer-events-none opacity-50': !canPrev})}
            onClick={() => canPrev && onPageChange(1)}
          />
        </PaginationItem>
        <PaginationItem>
          <PaginationPrevious
            aria-disabled={!canPrev}
            className={cn({'pointer-events-none opacity-50': !canPrev})}
            onClick={() => canPrev && onPageChange(page - 1)}
          />
        </PaginationItem>
        <PaginationItem>
          <PaginationNext
            aria-disabled={!canNext}
            className={cn({'pointer-events-none opacity-50': !canNext})}
            onClick={() => canNext && onPageChange(page + 1)}
          />
        </PaginationItem>
        <PaginationItem>
          <PaginationLast
            aria-disabled={!canNext}
            className={cn({'pointer-events-none opacity-50': !canNext})}
            onClick={() => canNext && onPageChange(pageCount)}
          />
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  )
}
