'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { CheckIcon, ChevronsUpDownIcon, FileTextIcon, PlusIcon, UploadIcon } from 'lucide-react'

import type {
  ColumnFiltersState,
  PaginationState,
  RowData
} from '@tanstack/react-table'
import {
  getCoreRowModel,
  getFacetedMinMaxValues,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table'

import { ListingEditDialog } from './listing-edit-dialog'
import { ListingRow } from './types'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { DataTable } from '@/components/tables/data-table'
import { TableFilter } from '@/components/tables/table-filter'
import { TablePagination } from '@/components/tables/table-pagination'
import { buildListingColumns } from './listings-columns'
import { usePagination } from '@/hooks/use-pagination'
import { useCanEdit } from '@/lib/auth/role-context'

declare module '@tanstack/react-table' {
  interface ColumnMeta<TData extends RowData, TValue> {
    filterVariant?: 'text' | 'range' | 'select'
    selectOptions?: { label: string; value: string }[]
  }
}

type ListingsTableProps = {
  data?: ListingRow[]
  totalCount?: number
}

type ListingsApiResponse = {
  data: ListingRow[]
  total: number
}

export function ListingsTable({ data, totalCount }: ListingsTableProps = {}) {
  const canEdit = useCanEdit()
  const isRemote = data === undefined
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [tableData, setTableData] = useState<ListingRow[]>(data ?? [])
  const [remoteTotal, setRemoteTotal] = useState(totalCount ?? data?.length ?? 0)
  const [isLoading, setIsLoading] = useState(isRemote)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [currencyOptions, setCurrencyOptions] = useState<{ label: string; value: string }[]>([])
  const [currencySearch, setCurrencySearch] = useState('')
  const [currencyLoading, setCurrencyLoading] = useState(false)
  const [currencyError, setCurrencyError] = useState<string | null>(null)
  const [marketOptions, setMarketOptions] = useState<{ label: string; value: string }[]>([])
  const [marketSearch, setMarketSearch] = useState('')
  const [marketLoading, setMarketLoading] = useState(false)
  const [marketError, setMarketError] = useState<string | null>(null)
  const [editingListing, setEditingListing] = useState<ListingRow | null>(null)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [pageSizeOpen, setPageSizeOpen] = useState(false)

  const pageSize = 10

  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize
  })
  const paginationItemsToDisplay = 10

  const handleEditListing = useCallback((listing: ListingRow) => {
    setEditingListing(listing)
    setIsEditorOpen(true)
  }, [])
  const handleDeleteListing = useCallback(
    async (listing: ListingRow) => {
      const label = listing.base || listing.id
      if (!window.confirm(`Delete listing ${label}? This cannot be undone.`)) {
        return
      }
      try {
        const response = await fetch(`/api/listings/${listing.id}`, { method: 'DELETE' })
        if (!response.ok) {
          const payload = await response.json().catch(() => null)
          const errorMessage =
            payload && typeof payload === 'object' && 'error' in payload
              ? String(payload.error)
              : `Request failed with ${response.status}`
          throw new Error(errorMessage)
        }
        setTableData(prev => prev.filter(row => row.id !== listing.id))
        setRemoteTotal(prev => Math.max(0, prev - 1))
        if (isRemote && tableData.length <= 1 && pagination.pageIndex > 0) {
          setPagination(prev => ({ ...prev, pageIndex: Math.max(0, prev.pageIndex - 1) }))
        }
        if (editingListing?.id === listing.id) {
          setEditingListing(null)
          setIsEditorOpen(false)
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unable to delete listing.'
        console.error('[listings] delete failed:', error)
        window.alert(message)
      }
    },
    [editingListing?.id, isRemote, pagination.pageIndex, tableData.length]
  )
  const handleEditorOpenChange = (open: boolean) => {
    setIsEditorOpen(open)
    if (!open) {
      setEditingListing(null)
    }
  }
  const handleListingUpdated = (updated: ListingRow) => {
    setTableData(prev => prev.map(row => (row.id === updated.id ? updated : row)))
    setEditingListing(updated)
  }
  const handleListingCreated = (created: ListingRow) => {
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
    if (filtersById.assetClass) params.set('assetClass', filtersById.assetClass)
    if (filtersById.base) params.set('base', filtersById.base)
    if (filtersById.quote) {
      params.set('quote', filtersById.quote === '—' ? '__null__' : filtersById.quote)
    }
    if (filtersById.marketId) params.set('marketId', filtersById.marketId)
    if (filtersById.active) {
      const normalizedActive = filtersById.active.toLowerCase()
      if (normalizedActive === 'active') params.set('active', 'true')
      if (normalizedActive === 'inactive') params.set('active', 'false')
    }

    const controller = new AbortController()
    setIsLoading(true)
    setLoadError(null)

    fetch(`/api/listings?${params.toString()}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) {
          throw new Error(`Request failed with ${response.status}`)
        }
        const payload = (await response.json()) as ListingsApiResponse
        setTableData(payload.data)
        setRemoteTotal(payload.total)
      })
      .catch(error => {
        if (error instanceof DOMException && error.name === 'AbortError') {
          return
        }
        setLoadError('Unable to load listings data.')
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
      setCurrencyLoading(true)
      setCurrencyError(null)

      const params = new URLSearchParams({ limit: '50' })
      const trimmed = currencySearch.trim()
      if (trimmed) params.set('query', trimmed)

      fetch(`/api/currencies?${params.toString()}`, { signal: controller.signal })
        .then(async response => {
          if (!response.ok) {
            throw new Error(`Request failed with ${response.status}`)
          }
          const payload = (await response.json()) as { data: { id: string; code: string; name: string }[] }
          const options = payload.data.map(currency => ({
            value: currency.code,
            label: `${currency.code}${currency.name ? ` — ${currency.name}` : ''}`
          }))
          setCurrencyOptions(options)
        })
        .catch(error => {
          if (error instanceof DOMException && error.name === 'AbortError') {
            return
          }
          setCurrencyError('Unable to load currencies.')
          setCurrencyOptions([])
        })
        .finally(() => {
          setCurrencyLoading(false)
        })
    }, 200)

    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [currencySearch, isRemote])

  useEffect(() => {
    if (!isRemote) return

    const controller = new AbortController()
    const timeout = setTimeout(() => {
      setMarketLoading(true)
      setMarketError(null)

      const params = new URLSearchParams({ limit: '200' })
      const trimmed = marketSearch.trim()
      if (trimmed) params.set('query', trimmed)

      fetch(`/api/markets?${params.toString()}`, { signal: controller.signal })
        .then(async response => {
          if (!response.ok) {
            throw new Error(`Request failed with ${response.status}`)
          }
          const payload = (await response.json()) as { data: { id: string; code: string; name: string | null }[] }
          const options = payload.data.map(market => ({
            value: market.id,
            label: market.name ? `${market.code} — ${market.name}` : market.code
          }))
          setMarketOptions(options)
        })
        .catch(error => {
          if (error instanceof DOMException && error.name === 'AbortError') {
            return
          }
          setMarketError('Unable to load markets.')
          setMarketOptions([])
        })
        .finally(() => {
          setMarketLoading(false)
        })
    }, 200)

    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [marketSearch, isRemote])

  const pageCount = isRemote ? Math.ceil(remoteTotal / pagination.pageSize) : undefined

  const columns = useMemo(
    () => buildListingColumns(handleEditListing, handleDeleteListing),
    [handleEditListing, handleDeleteListing]
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
      const response = await fetch('/api/listings/export')
      if (!response.ok) {
        throw new Error(`Request failed with ${response.status}`)
      }
      const blob = await response.blob()
      const link = document.createElement('a')
      const url = URL.createObjectURL(blob)
      const contentDisposition = response.headers.get('Content-Disposition') ?? ''
      const filenameMatch = /filename="([^"]+)"/.exec(contentDisposition)
      const fallbackName = `listings-export-${new Date().toISOString().split('T')[0]}.json`

      link.setAttribute('href', url)
      link.setAttribute('download', filenameMatch?.[1] ?? fallbackName)
      link.style.visibility = 'hidden'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('[listings] export failed:', error)
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
            <TableFilter column={table.getColumn('id')!} placeholder='Search listing (ID, base, or name)' hideLabel />
            <div className='grid flex-1 grid-cols-1 gap-4 min-w-0 sm:grid-cols-3 sm:items-end'>
              <TableFilter
                column={table.getColumn('assetClass')!}
                searchable
                searchPlaceholder='Search asset class...'
              />
              <TableFilter
                column={table.getColumn('quote')!}
                selectOptions={currencyOptions}
                searchable
                searchPlaceholder='Search quotes...'
                searchValue={currencySearch}
                onSearchChange={setCurrencySearch}
                searchLoading={currencyLoading}
                searchEmptyMessage={currencyError ?? 'No quotes found.'}
              />
              <TableFilter
                column={table.getColumn('marketId')!}
                selectOptions={marketOptions}
                searchable
                searchPlaceholder='Search markets...'
                searchValue={marketSearch}
                onSearchChange={setMarketSearch}
                searchLoading={marketLoading}
                searchEmptyMessage={marketError ?? 'No markets found.'}
              />
            </div>
            <div className='flex flex-wrap items-center gap-4 sm:justify-between'>
              <div className='flex items-center gap-2'>
                <Label htmlFor='rowSelect' className='sr-only'>
                  Show
                </Label>
                <Popover open={pageSizeOpen} onOpenChange={setPageSizeOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      id='rowSelect'
                      variant='outline'
                      className='w-fit whitespace-nowrap justify-between'
                      aria-label='Select rows per page'
                    >
                      <span className='mr-2'>Show {table.getState().pagination.pageSize}</span>
                      <ChevronsUpDownIcon className='h-4 w-4 opacity-50' aria-hidden='true' />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className='w-48 p-0' align='start'>
                    <Command>
                      <CommandInput placeholder='Search page size...' />
                      <CommandList>
                        <CommandGroup>
                          {[5, 10, 25, 50].map(pageSizeOption => (
                            <CommandItem
                              key={pageSizeOption}
                              value={pageSizeOption.toString()}
                              onSelect={() => {
                                table.setPageSize(pageSizeOption)
                                setPageSizeOpen(false)
                              }}
                            >
                              <span className='truncate'>{pageSizeOption}</span>
                              {table.getState().pagination.pageSize === pageSizeOption && (
                                <CheckIcon className='ml-auto h-4 w-4 opacity-60' aria-hidden='true' />
                              )}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
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
                  Add Listing
                </Button>
              )}
            </div>
          </div>
          <DataTable
            table={table}
            isLoading={isLoading}
            loadError={loadError}
            loadingMessage='Loading listings...'
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
        <ListingEditDialog
          listing={editingListing}
          open={isEditorOpen}
          onOpenChange={handleEditorOpenChange}
          onSave={handleListingUpdated}
        />
      )}
      {canEdit && (
        <ListingEditDialog
          listing={null}
          open={isCreateOpen}
          onOpenChange={setIsCreateOpen}
          onSave={handleListingCreated}
          mode='create'
        />
      )}
    </>
  )
}
