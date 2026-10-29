'use client'

import type { Table } from '@tanstack/react-table'
import { flexRender } from '@tanstack/react-table'
import { AlertTriangleIcon, ChevronDownIcon, ChevronUpIcon, InboxIcon } from 'lucide-react'

import { Alert, AlertContent, AlertDescription, AlertIcon } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import { Table as TablePrimitive, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

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
        <TablePrimitive containerClassName='overflow-visible' className='min-w-full table-fixed text-sm' style={tableStyle}>
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
                      aria-sort={
                        header.column.getIsSorted() === 'asc'
                          ? 'ascending'
                          : header.column.getIsSorted() === 'desc'
                            ? 'descending'
                            : header.column.getCanSort()
                              ? 'none'
                              : undefined
                      }
                    >
                      {header.isPlaceholder ? null : header.column.getCanSort() ? (
                        <Button
                          type='button'
                          variant='ghost'
                          size='sm'
                          className='h-8 w-full justify-between gap-2 bg-transparent px-2 text-muted-foreground hover:text-foreground'
                          onClick={() => header.column.toggleSorting(header.column.getIsSorted() === 'asc')}
                          aria-label={`Sort by ${typeof header.column.columnDef.header === 'string' ? header.column.columnDef.header : header.column.id}`}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {{
                            asc: <ChevronUpIcon className='shrink-0 opacity-60' size={16} aria-hidden='true' />,
                            desc: <ChevronDownIcon className='shrink-0 opacity-60' size={16} aria-hidden='true' />
                          }[header.column.getIsSorted() as string] ?? null}
                        </Button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </TableHead>
                  )
              })}
            </TableRow>
          ))}
          </TableHeader>
        </TablePrimitive>
      </div>

      <div className='min-h-0 flex-1 overflow-auto' style={{ scrollbarGutter: 'stable' }}>
        <TablePrimitive
          containerClassName='overflow-visible'
          className='min-w-full table-fixed text-sm'
          style={tableStyle}
          aria-busy={isLoading}
        >
          {colGroup}
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={visibleColumns.length} className='h-24'>
                  <div className='space-y-2 px-4' role='status' aria-live='polite'>
                    {Array.from({ length: 3 }, (_, index) => (
                      <Skeleton key={index} className='h-4 w-full' />
                    ))}
                    <span className='sr-only'>{loadingMessage}</span>
                  </div>
                </TableCell>
              </TableRow>
            ) : loadError ? (
              <TableRow>
                <TableCell colSpan={visibleColumns.length} className='h-24'>
                  <Alert variant='destructive' appearance='light' className='mx-auto max-w-xl'>
                    <AlertIcon><AlertTriangleIcon aria-hidden='true' /></AlertIcon>
                    <AlertContent><AlertDescription>{loadError}</AlertDescription></AlertContent>
                  </Alert>
                </TableCell>
              </TableRow>
            ) : table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map(row => (
                <TableRow key={row.id} data-state={row.getIsSelected() && 'selected'} className='hover:bg-muted/40'>
                  {row.getVisibleCells().map(cell => (
                    <TableCell key={cell.id} className='h-14 first:w-12 first:pl-4 last:w-28 last:px-4'>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={visibleColumns.length} className='h-28'>
                  <Empty className='min-h-28 border-0 p-4' role='status' aria-live='polite'>
                    <EmptyHeader>
                      <EmptyMedia variant='icon'><InboxIcon aria-hidden='true' /></EmptyMedia>
                      <EmptyTitle>{emptyMessage}</EmptyTitle>
                    </EmptyHeader>
                  </Empty>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </TablePrimitive>
      </div>
    </>
  )
}
