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

import { MarketEditDialog } from './markets-edit-dialog'
import { MarketRow, CountryOption, TimeZoneOption } from './types'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { DataTable } from '@/components/tables/data-table'
import { TableFilter } from '@/components/tables/table-filter'
import { TablePagination } from '@/components/tables/table-pagination'
import { buildMarketColumns } from './markets-columns'
import { usePagination } from '@/hooks/use-pagination'

declare module '@tanstack/react-table' {
  interface ColumnMeta<TData extends RowData, TValue> {
    filterVariant?: 'text' | 'range' | 'select'
    selectOptions?: { label: string; value: string }[]
  }
}

type MarketsTableProps = {
  data?: MarketRow[]
  totalCount?: number
}

type MarketsApiResponse = {
  data: MarketRow[]
  total: number
}

export function MarketsTable({ data, totalCount }: MarketsTableProps = {}) {
  const isRemote = data === undefined
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])
  const [tableData, setTableData] = useState<MarketRow[]>(data ?? [])
  const [remoteTotal, setRemoteTotal] = useState(totalCount ?? data?.length ?? 0)
  const [isLoading, setIsLoading] = useState(isRemote)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [countryOptions, setCountryOptions] = useState<{ label: string; value: string }[]>([])
  const [countrySearch, setCountrySearch] = useState('')
  const [countryLoading, setCountryLoading] = useState(false)
  const [countryError, setCountryError] = useState<string | null>(null)
  const [cityOptions, setCityOptions] = useState<{ label: string; value: string }[]>([])
  const [cityLoading, setCityLoading] = useState(false)
  const [cityError, setCityError] = useState<string | null>(null)
  const [tzOptions, setTzOptions] = useState<{ label: string; value: string }[]>([])
  const [tzSearch, setTzSearch] = useState('')
  const [tzLoading, setTzLoading] = useState(false)
  const [tzError, setTzError] = useState<string | null>(null)
  const [editingMarket, setEditingMarket] = useState<MarketRow | null>(null)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [pageSizeOpen, setPageSizeOpen] = useState(false)

  const pageSize = 10

  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize
  })
  const paginationItemsToDisplay = 10

  const handleEditMarket = useCallback((market: MarketRow) => {
    setEditingMarket(market)
    setIsEditorOpen(true)
  }, [])
  const handleDeleteMarket = useCallback(
    async (market: MarketRow) => {
      const label = market.code || market.id
      if (!window.confirm(`Delete market ${label}? This cannot be undone.`)) {
        return
      }
      try {
        const response = await fetch(`/api/markets/${market.id}`, { method: 'DELETE' })
        if (!response.ok) {
          const payload = await response.json().catch(() => null)
          const errorMessage =
            payload && typeof payload === 'object' && 'error' in payload
              ? String(payload.error)
              : `Request failed with ${response.status}`
          throw new Error(errorMessage)
        }
        setTableData(prev => prev.filter(row => row.id !== market.id))
        setRemoteTotal(prev => Math.max(0, prev - 1))
        if (isRemote && tableData.length <= 1 && pagination.pageIndex > 0) {
          setPagination(prev => ({ ...prev, pageIndex: Math.max(0, prev.pageIndex - 1) }))
        }
        if (editingMarket?.id === market.id) {
          setEditingMarket(null)
          setIsEditorOpen(false)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to delete market.'
        console.error('[markets] delete failed:', error)
        window.alert(message)
      }
    },
    [editingMarket?.id, isRemote, pagination.pageIndex, tableData.length]
  )

  const handleEditorOpenChange = (open: boolean) => {
    setIsEditorOpen(open)
    if (!open) setEditingMarket(null)
  }

  const handleMarketUpdated = (updated: MarketRow) => {
    setTableData(prev => prev.map(row => (row.id === updated.id ? updated : row)))
    setEditingMarket(updated)
  }

  const handleMarketCreated = (created: MarketRow) => {
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
    if (filtersById.countryId) params.set('countryId', filtersById.countryId)
    if (filtersById.cityId) params.set('cityId', filtersById.cityId)
    if (filtersById.timeZoneId) params.set('timeZoneId', filtersById.timeZoneId)

    const controller = new AbortController()
    setIsLoading(true)
    setLoadError(null)

    fetch(`/api/markets?${params.toString()}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) {
          throw new Error(`Request failed with ${response.status}`)
        }
        const payload = (await response.json()) as MarketsApiResponse
        setTableData(payload.data)
        setRemoteTotal(payload.total)
      })
      .catch(error => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setLoadError('Unable to load markets data.')
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
          const payload = (await response.json()) as { data: CountryOption[] }
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
      setCityLoading(true)
      setCityError(null)

      const loadAllCities = async () => {
        const pageSize = 100
        let page = 1
        let total = 0
        const options: { label: string; value: string }[] = []

        while (!controller.signal.aborted) {
          const params = new URLSearchParams({
            page: String(page),
            pageSize: String(pageSize)
          })

          const response = await fetch(`/api/cities?${params.toString()}`, { signal: controller.signal })
          if (!response.ok) {
            throw new Error(`Request failed with ${response.status}`)
          }

          const payload = (await response.json()) as { data: { id: string; name: string }[]; total: number }
          payload.data.forEach(city => {
            options.push({ value: city.id, label: city.name })
          })

          total = payload.total ?? options.length
          if (options.length >= total || payload.data.length === 0) break
          page += 1
        }

        if (!controller.signal.aborted) {
          setCityOptions(options)
        }
      }

      loadAllCities()
        .catch(error => {
          if (error instanceof DOMException && error.name === 'AbortError') return
          setCityError('Unable to load cities.')
          setCityOptions([])
        })
        .finally(() => {
          setCityLoading(false)
        })
    }, 200)

    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [isRemote])

  useEffect(() => {
    if (!isRemote) return

    const controller = new AbortController()
    const timeout = setTimeout(() => {
      setTzLoading(true)
      setTzError(null)

      const params = new URLSearchParams({ limit: '1000' })
      const trimmed = tzSearch.trim()
      const selectedTz = columnFilters.find(filter => filter.id === 'timeZoneId')?.value as string | undefined
      if (trimmed) {
        params.set('query', trimmed)
      } else if (selectedTz) {
        params.set('query', selectedTz)
      }

      fetch(`/api/time-zones?${params.toString()}`, { signal: controller.signal })
        .then(async response => {
          if (!response.ok) {
            throw new Error(`Request failed with ${response.status}`)
          }
          const payload = (await response.json()) as { data: TimeZoneOption[] }
          const options = payload.data.map(tz => {
            const offsetLabel = tz.offset
              ? ` (${tz.offset}${tz.offsetDst ? ` / ${tz.offsetDst}` : ''})`
              : ''
            return {
              value: tz.id,
              label: `${tz.name || tz.id}${offsetLabel}`
            }
          })
          setTzOptions(options)
        })
        .catch(error => {
          if (error instanceof DOMException && error.name === 'AbortError') return
          setTzError('Unable to load time zones.')
          setTzOptions([])
        })
        .finally(() => {
          setTzLoading(false)
        })
    }, 200)

    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [tzSearch, isRemote, columnFilters])

  const pageCount = isRemote ? Math.ceil(remoteTotal / pagination.pageSize) : undefined

  const columns = useMemo(
    () => buildMarketColumns(handleEditMarket, handleDeleteMarket),
    [handleEditMarket, handleDeleteMarket]
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
      const response = await fetch('/api/markets/export')
      if (!response.ok) {
        throw new Error(`Request failed with ${response.status}`)
      }
      const blob = await response.blob()
      const link = document.createElement('a')
      const url = URL.createObjectURL(blob)
      const contentDisposition = response.headers.get('Content-Disposition') ?? ''
      const filenameMatch = /filename="([^"]+)"/.exec(contentDisposition)
      const fallbackName = `markets-export-${new Date().toISOString().split('T')[0]}.json`

      link.setAttribute('href', url)
      link.setAttribute('download', filenameMatch?.[1] ?? fallbackName)
      link.style.visibility = 'hidden'
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('[markets] export failed:', error)
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
            <TableFilter column={table.getColumn('id')!} placeholder='Search market (ID, code, or name)' hideLabel />
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
                column={table.getColumn('cityId')!}
                selectOptions={cityOptions}
                searchable
                searchPlaceholder='Search city...'
                searchLoading={cityLoading}
                searchEmptyMessage={cityError ?? 'No cities found.'}
              />
              <TableFilter
                column={table.getColumn('timeZoneId')!}
                selectOptions={tzOptions}
                searchable
                searchPlaceholder='Search time zone...'
                searchValue={tzSearch}
                onSearchChange={setTzSearch}
                searchLoading={tzLoading}
                searchEmptyMessage={tzError ?? 'No time zones found.'}
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
              <Button variant='secondary' onClick={() => setIsCreateOpen(true)}>
                <PlusIcon className='h-4 w-4' />
                Add Market
              </Button>
            </div>
          </div>
          <DataTable
            table={table}
            isLoading={isLoading}
            loadError={loadError}
            loadingMessage='Loading markets...'
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
      <MarketEditDialog
        market={editingMarket}
        open={isEditorOpen}
        onOpenChange={handleEditorOpenChange}
        onSave={handleMarketUpdated}
      />
      <MarketEditDialog
        market={null}
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
        onSave={handleMarketCreated}
        mode='create'
      />
    </>
  )
}
