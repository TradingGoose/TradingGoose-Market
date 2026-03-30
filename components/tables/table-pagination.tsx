'use client'

import type { Table } from '@tanstack/react-table'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Pagination, PaginationContent, PaginationEllipsis, PaginationItem } from '@/components/ui/pagination'

type TablePaginationProps<TData> = {
  table: Table<TData>
  pages: number[]
  showLeftEllipsis?: boolean
  showRightEllipsis?: boolean
}

export function TablePagination<TData>({
  table,
  pages,
  showLeftEllipsis = false,
  showRightEllipsis = false
}: TablePaginationProps<TData>) {
  return (
    <Pagination className='justify-end'>
      <PaginationContent>
        <PaginationItem>
          <Button
            className='disabled:pointer-events-none disabled:opacity-50'
            variant={'ghost'}
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            aria-label='Go to previous page'
          >
            <ChevronLeftIcon aria-hidden='true' />
            <span className='max-sm:hidden'>Previous</span>
          </Button>
        </PaginationItem>

        {showLeftEllipsis && (
          <PaginationItem>
            <PaginationEllipsis />
          </PaginationItem>
        )}

        {pages.map(page => {
          const isActive = page === table.getState().pagination.pageIndex + 1

          return (
            <PaginationItem key={page}>
              <Button
                size='icon'
                className={`${!isActive &&
                  'bg-primary/10 text-primary hover:bg-primary-hover/20 focus-visible:ring-primary/20 dark:focus-visible:ring-primary/40'
                  }`}
                onClick={() => table.setPageIndex(page - 1)}
                aria-current={isActive ? 'page' : undefined}
              >
                {page}
              </Button>
            </PaginationItem>
          )
        })}

        {showRightEllipsis && (
          <PaginationItem>
            <PaginationEllipsis />
          </PaginationItem>
        )}

        <PaginationItem>
          <Button
            className='disabled:pointer-events-none disabled:opacity-50'
            variant={'ghost'}
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            aria-label='Go to next page'
          >
            <span className='max-sm:hidden'>Next</span>
            <ChevronRightIcon aria-hidden='true' />
          </Button>
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  )
}
