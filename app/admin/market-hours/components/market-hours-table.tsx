'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { CheckIcon, ChevronsUpDownIcon, FileTextIcon, PlusIcon, UploadIcon } from 'lucide-react'

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

import { MarketHourRow } from './types'
import { buildMarketHoursColumns } from './market-hours-columns'
import { MarketHoursEditDialog } from './market-hours-edit-dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { DataTable } from '@/components/tables/data-table'
import { TableFilter } from '@/components/tables/table-filter'
import { TablePagination } from '@/components/tables/table-pagination'
import { usePagination } from '@/hooks/use-pagination'

declare module '@tanstack/react-table' {
  interface ColumnMeta<TData extends RowData, TValue> {
    filterVariant?: 'text' | 'range' | 'select'
    selectOptions?: { label: string; value: string }[]
  }
}

type MarketHoursTableProps = {
  data?: MarketHourRow[]
  totalCount?: number
}

type MarketHoursApiResponse = {
  data: MarketHourRow[]
  total: number
}

export function MarketHoursTable({ data, totalCount }: MarketHoursTableProps = {}) {
  const isRemote = data === undefined
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [tableData, setTableData] = useState<MarketHourRow[]>(data ?? [])
  const [remoteTotal, setRemoteTotal] = useState(totalCount ?? data?.length ?? 0)
  const [isLoading, setIsLoading] = useState(isRemote)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [countryOptions, setCountryOptions] = useState<{ label: string; value: string }[]>([])
  const [countrySearch, setCountrySearch] = useState('')
  const [countryLoading, setCountryLoading] = useState(false)
  const [countryError, setCountryError] = useState<string | null>(null)
  const [marketOptions, setMarketOptions] = useState<{ label: string; value: string }[]>([])
  const [marketSearch, setMarketSearch] = useState('')
  const [marketLoading, setMarketLoading] = useState(false)
  const [marketError, setMarketError] = useState<string | null>(null)
  const [pageSizeOpen, setPageSizeOpen] = useState(false)
  const [editingRow, setEditingRow] = useState<MarketHourRow | null>(null)
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [isCreateOpen, setIsCreateOpen] = useState(false)

  const pageSize = 10

  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize
  })
  const paginationItemsToDisplay = 10

  const handleEdit = useCallback((row: MarketHourRow) => {
    setEditingRow(row)
    setIsEditorOpen(true)
  }, [])
  const handleDelete = useCallback(
    async (row: MarketHourRow) => {
      const label = row.listingBase ?? row.marketCode ?? row.marketName ?? row.id
      if (!window.confirm(`Delete market hours for ${label}? This cannot be undone.`)) {
        return
      }
      try {
        const response = await fetch(`/api/market-hours/${row.id}`, { method: 'DELETE' })
        if (!response.ok) {
          const payload = await response.json().catch(() => null)
          const errorMessage =
            payload && typeof payload === 'object' && 'error' in payload
              ? String(payload.error)
              : `Request failed with ${response.status}`
          throw new Error(errorMessage)
        }
        setTableData(prev => prev.filter(item => item.id !== row.id))
        setRemoteTotal(prev => Math.max(0, prev - 1))
        if (isRemote && tableData.length <= 1 && pagination.pageIndex > 0) {
          setPagination(prev => ({ ...prev, pageIndex: Math.max(0, prev.pageIndex - 1) }))
        }
        if (editingRow?.id === row.id) {
          setEditingRow(null)
          setIsEditorOpen(false)
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unable to delete market hours.'
        console.error('[market-hours] delete failed:', error)
        window.alert(message)
      }
    },
    [editingRow?.id, isRemote, pagination.pageIndex, tableData.length]
  )

  const handleMarketHoursUpdated = (updated: MarketHourRow) => {
    setTableData(prev => prev.map(row => (row.id === updated.id ? updated : row)))
    setEditingRow(updated)
  }

  const handleMarketHoursCreated = (created: MarketHourRow) => {
    setTableData(prev => {
      const withoutDup = prev.filter(row => row.id !== created.id)
      return [created, ...withoutDup]
    })
    setRemoteTotal(prev => prev + 1)
    setPagination(prev => ({ ...prev, pageIndex: 0 }))
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

    if (filtersById.q) params.set('q', filtersById.q)
    if (filtersById.countryId) params.set('countryId', filtersById.countryId)
    if (filtersById.marketId) params.set('marketId', filtersById.marketId)
    if (filtersById.assetClass) params.set('assetClass', filtersById.assetClass)

    const controller = new AbortController()
    setIsLoading(true)
    setLoadError(null)

    fetch(`/api/market-hours?${params.toString()}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) {
          throw new Error(`Request failed with ${response.status}`)
        }
        const payload = (await response.json()) as MarketHoursApiResponse
        setTableData(payload.data)
        setRemoteTotal(payload.total)
      })
      .catch(error => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setLoadError('Unable to load market hours data.')
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
      setCountryLoading(true)
      setCountryError(null)

      const params = new URLSearchParams({ limit: '200' })
      const trimmed = countrySearch.trim()
      if (trimmed) params.set('query', trimmed)

      fetch(`/api/countries?${params.toString()}`, { signal: controller.signal })
        .then(async response => {
          if (!response.ok) {
            throw new Error(`Request failed with ${response.status}`)
          }
          const payload = (await response.json()) as { data: { id: string; code: string; name: string }[] }
          const options = payload.data.map(country => ({
            value: country.id,
            label: `${country.code}${country.name ? ` — ${country.name}` : ''}`
          }))
          setCountryOptions(options)
        })
        .catch(error => {
          if (error instanceof DOMException && error.name === 'AbortError') return
          setCountryError('Unable to load countries.')
          setCountryOptions([])
        })
        .finally(() => {
          setCountryLoading(false)
        })
    }, 200)

    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [countrySearch, isRemote])

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
          if (error instanceof DOMException && error.name === 'AbortError') return
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
    () => buildMarketHoursColumns(handleEdit, handleDelete),
    [handleEdit, handleDelete]
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
        id: false,
        q: false,
        countryId: false,
        marketId: false
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
      const response = await fetch('/api/market-hours/export')
      if (!response.ok) {
        throw new Error(`Request failed with ${response.status}`)
      }
      const blob = await response.blob()
      const link = document.createElement('a')
      const url = URL.createObjectURL(blob)
      const contentDisposition = response.headers.get('Content-Disposition') ?? ''
      const filenameMatch = /filename="([^"]+)"/.exec(contentDisposition)
      const fallbackName = `market-hours-export-${new Date().toISOString().split('T')[0]}.json`

      link.setAttribute('href', url)
      link.setAttribute('download', filenameMatch?.[1] ?? fallbackName)
      link.style.visibility = 'hidden'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('[market-hours] export failed:', error)
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
            <TableFilter column={table.getColumn('q')!} placeholder='Search market hours (ID, market, listing, country)' hideLabel />
            <div className='grid flex-1 grid-cols-3 gap-4 min-w-0 xs:grid-cols-3 xl:grid-cols-4 sm:items-end'>
              <TableFilter
                column={table.getColumn('countryId')!}
                selectOptions={countryOptions}
                searchable
                searchPlaceholder='Search country...'
                searchValue={countrySearch}
                onSearchChange={setCountrySearch}
                searchLoading={countryLoading}
                searchEmptyMessage={countryError ?? 'No countries found.'}
              />
              <TableFilter
                column={table.getColumn('marketId')!}
                selectOptions={marketOptions}
                searchable
                searchPlaceholder='Search market...'
                searchValue={marketSearch}
                onSearchChange={setMarketSearch}
                searchLoading={marketLoading}
                searchEmptyMessage={marketError ?? 'No markets found.'}
              />
              <TableFilter column={table.getColumn('assetClass')!} searchable searchPlaceholder='Search asset class...' />
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
              <Button variant='secondary' onClick={() => setIsCreateOpen(true)}>
                <PlusIcon className='h-4 w-4' />
                Add Market Hours
              </Button>
            </div>
          </div>
          <DataTable
            table={table}
            isLoading={isLoading}
            loadError={loadError}
            loadingMessage='Loading market hours...'
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
      <MarketHoursEditDialog
        row={editingRow}
        open={isEditorOpen}
        onOpenChange={setIsEditorOpen}
        onSave={handleMarketHoursUpdated}
      />
      <MarketHoursEditDialog
        row={null}
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        onSave={handleMarketHoursCreated}
        mode='create'
      />
    </>
  )
}
