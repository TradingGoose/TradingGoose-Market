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

import { CryptoEditDialog } from './cryptos-edit-dialog'
import { CryptoRow } from './types'
import { Button } from '@/components/ui/button'
import { DataTable } from '@/components/tables/data-table'
import { TableFilter } from '@/components/tables/table-filter'
import { TablePagination } from '@/components/tables/table-pagination'
import { buildCryptoColumns } from './cryptos-columns'
import { usePagination } from '@/hooks/use-pagination'

declare module '@tanstack/react-table' {
  interface ColumnMeta<TData extends RowData, TValue> {
    filterVariant?: 'text' | 'range' | 'select'
    selectOptions?: { label: string; value: string }[]
  }
}

type CryptosTableProps = {
  data?: CryptoRow[]
  totalCount?: number
}

type CryptosApiResponse = {
  data: CryptoRow[]
  total: number
}

export function CryptosTable({ data, totalCount }: CryptosTableProps = {}) {
  const isRemote = data === undefined
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [tableData, setTableData] = useState<CryptoRow[]>(data ?? [])
  const [remoteTotal, setRemoteTotal] = useState(totalCount ?? data?.length ?? 0)
  const [isLoading, setIsLoading] = useState(isRemote)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [chainOptions, setChainOptions] = useState<{ label: string; value: string }[]>([])
  const [chainSearch, setChainSearch] = useState('')
  const [chainLoading, setChainLoading] = useState(false)
  const [chainError, setChainError] = useState<string | null>(null)
  const [editingCrypto, setEditingCrypto] = useState<CryptoRow | null>(null)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isEditorOpen, setIsEditorOpen] = useState(false)

  const pageSize = 10

  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize
  })
  const paginationItemsToDisplay = 10

  const handleEditCrypto = useCallback((crypto: CryptoRow) => {
    setEditingCrypto(crypto)
    setIsEditorOpen(true)
  }, [])
  const handleDeleteCrypto = useCallback(
    async (crypto: CryptoRow) => {
      const label = crypto.code || crypto.id
      if (!window.confirm(`Delete crypto ${label}? This cannot be undone.`)) {
        return
      }
      try {
        const response = await fetch(`/api/cryptos/${crypto.id}`, { method: 'DELETE' })
        if (!response.ok) {
          const payload = await response.json().catch(() => null)
          const errorMessage =
            payload && typeof payload === 'object' && 'error' in payload
              ? String(payload.error)
              : `Request failed with ${response.status}`
          throw new Error(errorMessage)
        }
        setTableData(prev => prev.filter(row => row.id !== crypto.id))
        setRemoteTotal(prev => Math.max(0, prev - 1))
        if (isRemote && tableData.length <= 1 && pagination.pageIndex > 0) {
          setPagination(prev => ({ ...prev, pageIndex: Math.max(0, prev.pageIndex - 1) }))
        }
        if (editingCrypto?.id === crypto.id) {
          setEditingCrypto(null)
          setIsEditorOpen(false)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to delete crypto.'
        console.error('[cryptos] delete failed:', error)
        window.alert(message)
      }
    },
    [editingCrypto?.id, isRemote, pagination.pageIndex, tableData.length]
  )

  const handleEditorOpenChange = (open: boolean) => {
    setIsEditorOpen(open)
    if (!open) setEditingCrypto(null)
  }

  const handleCryptoUpdated = (updated: CryptoRow) => {
    setTableData(prev => prev.map(row => (row.id === updated.id ? updated : row)))
    setEditingCrypto(updated)
  }

  const handleCryptoCreated = (created: CryptoRow) => {
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

    if (filtersById.id) params.set('query', filtersById.id)
    if (filtersById.chainId) params.set('chainId', filtersById.chainId)
    if (filtersById.assetType) params.set('assetType', filtersById.assetType)

    const controller = new AbortController()
    setIsLoading(true)
    setLoadError(null)

    fetch(`/api/cryptos?${params.toString()}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) {
          throw new Error(`Request failed with ${response.status}`)
        }
        const payload = (await response.json()) as CryptosApiResponse
        setTableData(payload.data)
        setRemoteTotal(payload.total)
      })
      .catch(error => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setLoadError('Unable to load cryptos data.')
        setTableData([])
        setRemoteTotal(0)
      })
      .finally(() => {
        setIsLoading(false)
      })

    return () => controller.abort()
  }, [columnFilters, filtersKey, isRemote, pagination.pageIndex, pagination.pageSize])

  useEffect(() => {
    if (!isRemote) return

    const controller = new AbortController()
    const timeout = setTimeout(() => {
      setChainLoading(true)
      setChainError(null)

      const params = new URLSearchParams({ limit: '50' })
      const trimmed = chainSearch.trim()
      if (trimmed) params.set('query', trimmed)

      fetch(`/api/chains?${params.toString()}`, { signal: controller.signal })
        .then(async response => {
          if (!response.ok) {
            throw new Error(`Request failed with ${response.status}`)
          }
          const payload = (await response.json()) as { data: { id: string; code: string; name: string }[] }
          const options = payload.data.map(chain => ({
            value: chain.id,
            label: `${chain.code}${chain.name ? ` — ${chain.name}` : ''}`
          }))
          setChainOptions(options)
        })
        .catch(error => {
          if (error instanceof DOMException && error.name === 'AbortError') return
          setChainError('Unable to load chains.')
          setChainOptions([])
        })
        .finally(() => {
          setChainLoading(false)
        })
    }, 200)

    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [chainSearch, isRemote])

  const pageCount = isRemote ? Math.ceil(remoteTotal / pagination.pageSize) : undefined

  const columns = useMemo(
    () => buildCryptoColumns(handleEditCrypto, handleDeleteCrypto),
    [handleEditCrypto, handleDeleteCrypto]
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
      const response = await fetch('/api/cryptos/export')
      if (!response.ok) {
        throw new Error(`Request failed with ${response.status}`)
      }
      const blob = await response.blob()
      const link = document.createElement('a')
      const url = URL.createObjectURL(blob)
      const contentDisposition = response.headers.get('Content-Disposition') ?? ''
      const filenameMatch = /filename="([^"]+)"/.exec(contentDisposition)
      const fallbackName = `cryptos-export-${new Date().toISOString().split('T')[0]}.json`

      link.setAttribute('href', url)
      link.setAttribute('download', filenameMatch?.[1] ?? fallbackName)
      link.style.visibility = 'hidden'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('[cryptos] export failed:', error)
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
            <TableFilter column={table.getColumn('id')!} placeholder='Search crypto (code or name)' hideLabel />
            <div className='grid flex-1 grid-cols-2 gap-4 min-w-0 xs:grid-cols-2 sm:items-end'>
              <TableFilter
                column={table.getColumn('assetType')!}
                searchable
                searchPlaceholder='Search asset types...'
              />
              <TableFilter
                column={table.getColumn('chainId')!}
                selectOptions={chainOptions}
                searchable
                searchPlaceholder='Search chains...'
                searchValue={chainSearch}
                onSearchChange={setChainSearch}
                searchLoading={chainLoading}
                searchEmptyMessage={chainError ?? 'No chains found.'}
              />
            </div>
            <div className='flex flex-wrap items-center gap-4 sm:justify-between'>
              <Button
                className='bg-primary/10 text-primary hover:bg-primary/20 focus-visible:ring-primary/20 dark:focus-visible:ring-primary/40'
                onClick={exportToJSON}
              >
                <UploadIcon className='h-4 w-4' />
                <span>Export JSON</span>
                <FileTextIcon className='h-4 w-4 opacity-70' />
              </Button>
              <Button variant='secondary' onClick={() => setIsCreateOpen(true)}>
                <PlusIcon className='h-4 w-4' />
                Add Crypto
              </Button>
            </div>
          </div>
          <DataTable
            table={table}
            isLoading={isLoading}
            loadError={loadError}
            loadingMessage='Loading cryptos...'
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
      <CryptoEditDialog
        crypto={editingCrypto}
        open={isEditorOpen}
        onOpenChange={handleEditorOpenChange}
        onSave={handleCryptoUpdated}
      />
      <CryptoEditDialog
        crypto={null}
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        onSave={handleCryptoCreated}
        mode='create'
      />
    </>
  )
}
