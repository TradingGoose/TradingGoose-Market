'use client'

import type { Table } from '@tanstack/react-table'
import { flexRender } from '@tanstack/react-table'
import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react'

import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/ui/utils'

type DataTableProps<TData> = {
  table: Table<TData>
  isLoading?: boolean
  loadError?: string | null
  loadingMessage?: string
  emptyMessage?: string
}

export function DataTable<TData>({
  table,
  isLoading = false,
  loadError,
  loadingMessage = 'Loading...',
  emptyMessage = 'No results.'
}: DataTableProps<TData>) {
  const visibleColumns = table.getVisibleLeafColumns()
  const tableWidth = visibleColumns.reduce((sum, column) => sum + column.getSize(), 0)
  const tableStyle = tableWidth ? { width: `${tableWidth}px` } : undefined

  const colGroup = (
    <colgroup>
      {visibleColumns.map(column => (
        <col key={column.id} style={{ width: `${column.getSize()}px` }} />
      ))}
    </colgroup>
  )

  return (
    <>
      <div className='shrink-0 overflow-x-auto border-t bg-card'>
        <table className='min-w-full table-fixed text-sm' style={tableStyle}>
          {colGroup}
          <TableHeader className='bg-card'>
            {table.getHeaderGroups().map(headerGroup => (
              <TableRow key={headerGroup.id} className='h-14 border-b'>
                {headerGroup.headers.map(header => {
                  return (
                    <TableHead
                      key={header.id}
                      style={{ width: `${header.getSize()}px` }}
                      className='text-muted-foreground first:pl-4 last:px-4'
                    >
                      {header.isPlaceholder ? null : header.column.getCanSort() ? (
                        <div
                          className={cn(
                            header.column.getCanSort() &&
                            'flex h-full cursor-pointer items-center justify-between gap-2 select-none'
                          )}
                          onClick={header.column.getToggleSortingHandler()}
                          onKeyDown={e => {
                            if (header.column.getCanSort() && (e.key === 'Enter' || e.key === ' ')) {
                              e.preventDefault()
                              header.column.getToggleSortingHandler()?.(e)
                            }
                          }}
                          tabIndex={header.column.getCanSort() ? 0 : undefined}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {{
                            asc: <ChevronUpIcon className='shrink-0 opacity-60' size={16} aria-hidden='true' />,
                            desc: <ChevronDownIcon className='shrink-0 opacity-60' size={16} aria-hidden='true' />
                          }[header.column.getIsSorted() as string] ?? null}
                        </div>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
        </table>
      </div>

      <div className='min-h-0 flex-1 overflow-auto' style={{ scrollbarGutter: 'stable' }}>
        <table className='min-w-full table-fixed text-sm' style={tableStyle}>
          {colGroup}
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={visibleColumns.length} className='h-24 text-center text-muted-foreground'>
                  {loadingMessage}
                </TableCell>
              </TableRow>
            ) : loadError ? (
              <TableRow>
                <TableCell colSpan={visibleColumns.length} className='h-24 text-center text-destructive'>
                  {loadError}
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map(row => (
                <TableRow key={row.id} data-state={row.getIsSelected() && 'selected'} className='hover:bg-transparent'>
                  {row.getVisibleCells().map(cell => (
                    <TableCell key={cell.id} className='h-14 first:w-12 first:pl-4 last:w-28 last:px-4'>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={visibleColumns.length} className='h-24 text-center'>
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </table>
      </div>
    </>
  )
}
