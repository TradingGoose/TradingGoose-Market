'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { FileTextIcon, PlusIcon, UploadIcon } from 'lucide-react'

import type { ColumnFiltersState, PaginationState, RowData } from '@tanstack/react-table'
import {
  getCoreRowModel,
  getFacetedMinMaxValues,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable
} from '@tanstack/react-table'

import { ChainEditDialog } from './chains-edit-dialog'
import { ChainRow } from './types'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/tables/data-table'
import { TableFilter } from '@/components/tables/table-filter'
import { TablePagination } from '@/components/tables/table-pagination'
import { buildChainColumns } from './chains-columns'
import { usePagination } from '@/hooks/use-pagination'
import { useCanEdit } from '@/lib/auth/role-context'

declare module '@tanstack/react-table' {
  interface ColumnMeta<TData extends RowData, TValue> {
    filterVariant?: 'text' | 'range' | 'select'
    selectOptions?: { label: string; value: string }[]
  }
}

type ChainsTableProps = {
  data?: ChainRow[]
  totalCount?: number
}

type ChainsApiResponse = {
  data: ChainRow[]
  total: number
}

export function ChainsTable({ data, totalCount }: ChainsTableProps = {}) {
  const canEdit = useCanEdit()
  const isRemote = data === undefined
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [tableData, setTableData] = useState<ChainRow[]>(data ?? [])
  const [remoteTotal, setRemoteTotal] = useState(totalCount ?? data?.length ?? 0)
  const [isLoading, setIsLoading] = useState(isRemote)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editingChain, setEditingChain] = useState<ChainRow | null>(null)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isEditorOpen, setIsEditorOpen] = useState(false)

  const pageSize = 10

  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize
  })
  const paginationItemsToDisplay = 10

  const handleEditChain = useCallback((chain: ChainRow) => {
    setEditingChain(chain)
    setIsEditorOpen(true)
  }, [])
  const handleDeleteChain = useCallback(
    async (chain: ChainRow) => {
      const label = chain.code || chain.id
      if (!window.confirm(`Delete chain ${label}? This cannot be undone.`)) {
        return
      }
      try {
        const response = await fetch(`/api/chains/${chain.id}`, { method: 'DELETE' })
        if (!response.ok) {
          const payload = await response.json().catch(() => null)
          const errorMessage =
            payload && typeof payload === 'object' && 'error' in payload
              ? String(payload.error)
              : `Request failed with ${response.status}`
          throw new Error(errorMessage)
        }
        setTableData(prev => prev.filter(row => row.id !== chain.id))
        setRemoteTotal(prev => Math.max(0, prev - 1))
        if (isRemote && tableData.length <= 1 && pagination.pageIndex > 0) {
          setPagination(prev => ({ ...prev, pageIndex: Math.max(0, prev.pageIndex - 1) }))
        }
        if (editingChain?.id === chain.id) {
          setEditingChain(null)
          setIsEditorOpen(false)
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unable to delete chain.'
        console.error('[chains] delete failed:', error)
        window.alert(message)
      }
    },
    [editingChain?.id, isRemote, pagination.pageIndex, tableData.length]
  )

  const handleEditorOpenChange = (open: boolean) => {
    setIsEditorOpen(open)
    if (!open) setEditingChain(null)
  }

  const handleChainUpdated = (updated: ChainRow) => {
    setTableData(prev => prev.map(row => (row.id === updated.id ? updated : row)))
    setEditingChain(updated)
  }

  const handleChainCreated = (created: ChainRow) => {
    setTableData(prev => {
      const withoutDup = prev.filter(row => row.id !== created.id)
      return [created, ...withoutDup]
    })
    setRemoteTotal(prev => prev + 1)
    setPagination(prev => ({ ...prev, pageIndex: 0 }))
    setIsCreateOpen(false)
  }

  const filtersKey = useMemo(
    () => columnFilters.map(filter => `${filter.id}:${String(filter.value)}`).join('|'),
    [columnFilters]
  )
  const lastFiltersKeyRef = useRef(filtersKey)

  useEffect(() => {
    if (!isRemote) return

    const filtersChanged = filtersKey !== lastFiltersKeyRef.current
    if (filtersChanged && pagination.pageIndex !== 0) {
      lastFiltersKeyRef.current = filtersKey
      setPagination(prev => (prev.pageIndex === 0 ? prev : { ...prev, pageIndex: 0 }))
      return
    }

    lastFiltersKeyRef.current = filtersKey

    const filtersById = columnFilters.reduce<Record<string, string>>((acc, filter) => {
      if (typeof filter.value === 'string' && filter.value.trim()) {
        acc[filter.id] = filter.value.trim()
      }
      return acc
    }, {})

    const params = new URLSearchParams({
      page: String(pagination.pageIndex + 1),
      pageSize: String(pagination.pageSize)
    })

    if (filtersById.id) params.set('id', filtersById.id)

    const controller = new AbortController()
    setIsLoading(true)
    setLoadError(null)

    fetch(`/api/chains?${params.toString()}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) {
          throw new Error(`Request failed with ${response.status}`)
        }
        const payload = (await response.json()) as ChainsApiResponse
        setTableData(payload.data)
        setRemoteTotal(payload.total)
      })
      .catch(error => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setLoadError('Unable to load chains data.')
        setTableData([])
        setRemoteTotal(0)
      })
      .finally(() => {
        setIsLoading(false)
      })

    return () => controller.abort()
  }, [columnFilters, filtersKey, isRemote, pagination.pageIndex, pagination.pageSize])

  const pageCount = isRemote ? Math.ceil(remoteTotal / pagination.pageSize) : undefined

  const columns = useMemo(
    () => buildChainColumns(handleEditChain, handleDeleteChain),
    [handleEditChain, handleDeleteChain]
  )

  const table = useReactTable({
    data: tableData,
    columns,
    state: {
      columnFilters,
      pagination
    },
    initialState: {
      columnVisibility: {
        id: false
      }
    },
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    getFacetedMinMaxValues: getFacetedMinMaxValues(),
    enableSortingRemoval: false,
    onPaginationChange: setPagination,
    ...(isRemote
      ? {
        manualPagination: true,
        manualFiltering: true,
        pageCount
      }
      : {
        getFilteredRowModel: getFilteredRowModel(),
        getPaginationRowModel: getPaginationRowModel()
      })
  })

  const exportToJSON = async () => {
    try {
      const response = await fetch('/api/chains/export')
      if (!response.ok) {
        throw new Error(`Request failed with ${response.status}`)
      }
      const blob = await response.blob()
      const link = document.createElement('a')
      const url = URL.createObjectURL(blob)
      const contentDisposition = response.headers.get('Content-Disposition') ?? ''
      const filenameMatch = /filename="([^"]+)"/.exec(contentDisposition)
      const fallbackName = `chains-export-${new Date().toISOString().split('T')[0]}.json`

      link.setAttribute('href', url)
      link.setAttribute('download', filenameMatch?.[1] ?? fallbackName)
      link.style.visibility = 'hidden'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('[chains] export failed:', error)
    }
  }

  const { pages, showLeftEllipsis, showRightEllipsis } = usePagination({
    currentPage: table.getState().pagination.pageIndex + 1,
    totalPages: table.getPageCount(),
    paginationItemsToDisplay
  })

  return (
    <>
      <div className='flex min-h-0 w-full flex-1 flex-col gap-4 overflow-hidden min-w-0'>
        <div className='flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border bg-card'>
          <div className='flex flex-col gap-4 border-b p-6 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between'>
            <TableFilter column={table.getColumn('id')!} placeholder='Search chain (ID, code, or name)' hideLabel />
            <div className='flex-1' />
            <div className='flex flex-wrap items-center gap-4 sm:justify-between'>
              <Button
                className='bg-primary/10 text-primary hover:bg-primary/20 focus-visible:ring-primary/20 dark:focus-visible:ring-primary/40'
                onClick={exportToJSON}
              >
                <UploadIcon className='h-4 w-4' />
                <span>Export JSON</span>
                <FileTextIcon className='h-4 w-4 opacity-70' />
              </Button>
            {canEdit && (
              <Button variant='secondary' onClick={() => setIsCreateOpen(true)}>
                <PlusIcon className='h-4 w-4' />
                Add Chain
              </Button>
            )}
            </div>
          </div>
          <DataTable
            table={table}
            isLoading={isLoading}
            loadError={loadError}
            loadingMessage='Loading currencies...'
          />
        </div>

        <div className='flex items-center justify-between gap-3 p-0 max-sm:flex-col'>
          <p className='text-muted-foreground text-sm whitespace-nowrap' aria-live='polite'>
            Showing{' '}
            <span>
              {isRemote && remoteTotal === 0
                ? 0
                : table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1}{' '}
              to{' '}
              {Math.min(
                Math.max(
                  table.getState().pagination.pageIndex * table.getState().pagination.pageSize +
                  table.getState().pagination.pageSize,
                  0
                ),
                isRemote ? remoteTotal : table.getRowCount()
              )}
            </span>{' '}
            of <span>{(isRemote ? remoteTotal : table.getRowCount()).toString()} entries</span>
          </p>

          <TablePagination
            table={table}
            pages={pages}
            showLeftEllipsis={showLeftEllipsis}
            showRightEllipsis={showRightEllipsis}
          />
        </div>
      </div>
      {canEdit && (
        <ChainEditDialog
          chain={editingChain}
          open={isEditorOpen}
          onOpenChange={handleEditorOpenChange}
          onSave={handleChainUpdated}
        />
      )}
      {canEdit && (
        <ChainEditDialog
          chain={null}
          open={isCreateOpen}
          onOpenChange={setIsCreateOpen}
          onSave={handleChainCreated}
          mode='create'
        />
      )}
    </>
  )
}
