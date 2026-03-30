'use client'

import { useEffect, useId, useMemo, useState } from 'react'

import type { Column } from '@tanstack/react-table'
import {
  CheckIcon,
  ChevronsUpDownIcon,
  Loader2,
  SearchIcon
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/ui/utils'

type SelectOption = { label: string; value: string }

export type TableFilterProps = {
  column: Column<any, unknown>
  placeholder?: string
  hideLabel?: boolean
  selectOptions?: SelectOption[]
  searchable?: boolean
  searchPlaceholder?: string
  searchValue?: string
  onSearchChange?: (value: string) => void
  searchLoading?: boolean
  searchEmptyMessage?: string
}

/**
 * Generic table column filter that supports text, select, and searchable select modes.
 * Separated to keep table components small and reusable.
 */
export function TableFilter({
  column,
  placeholder,
  hideLabel = false,
  selectOptions,
  searchable = false,
  searchPlaceholder,
  searchValue,
  onSearchChange,
  searchLoading = false,
  searchEmptyMessage
}: TableFilterProps) {
  const id = useId()
  const columnFilterValue = column.getFilterValue()
  const { filterVariant } = column.columnDef.meta ?? {}
  const metaSelectOptions = column.columnDef.meta?.selectOptions ?? []
  const resolvedSelectOptions = selectOptions !== undefined ? selectOptions : metaSelectOptions
  const columnHeader = typeof column.columnDef.header === 'string' ? column.columnDef.header : ''
  const [inputValue, setInputValue] = useState(columnFilterValue?.toString() ?? '')
  const [internalSearchValue, setInternalSearchValue] = useState('')
  const [comboboxOpen, setComboboxOpen] = useState(false)

  const sortedUniqueValues = useMemo(() => {
    if (filterVariant === 'range') return []

    const values = Array.from(column.getFacetedUniqueValues().keys())

    const flattenedValues = values.reduce((acc: string[], curr) => {
      if (Array.isArray(curr)) {
        return [...acc, ...curr]
      }

      return [...acc, curr]
    }, [])

    return Array.from(new Set(flattenedValues)).sort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [column.getFacetedUniqueValues(), filterVariant])

  useEffect(() => {
    setInputValue(columnFilterValue?.toString() ?? '')
  }, [columnFilterValue])

  const applyTextFilter = () => {
    const trimmed = inputValue.trim()
    column.setFilterValue(trimmed ? trimmed : undefined)
  }

  if (filterVariant === 'select') {
    const selectedValue = columnFilterValue?.toString() ?? 'all'
    const options =
      resolvedSelectOptions.length > 0
        ? resolvedSelectOptions
        : selectOptions !== undefined
          ? []
          : sortedUniqueValues.map(value => ({ label: String(value), value: String(value) }))

    const effectiveSearchValue = typeof searchValue === 'string' ? searchValue : internalSearchValue
    const handleSearchChange = (value: string) => {
      if (onSearchChange) {
        onSearchChange(value)
      } else {
        setInternalSearchValue(value)
      }
    }

    const selectedLabel =
      selectedValue === 'all'
        ? `Select ${columnHeader}`
        : options.find(option => option.value === selectedValue)?.label ?? selectedValue

    return (
      <div className='w-full space-y-2'>
        <Popover open={comboboxOpen} onOpenChange={setComboboxOpen}>
          <PopoverTrigger asChild>
            <Button
              id={`${id}-combobox`}
              variant='outline'
              role='combobox'
              aria-expanded={comboboxOpen}
              className='w-full justify-between'
            >
              <span className={cn('truncate', selectedValue === 'all' && 'text-muted-foreground')}>
                {selectedLabel}
              </span>
              <ChevronsUpDownIcon className='ml-2 h-4 w-4 shrink-0 opacity-50' />
            </Button>
          </PopoverTrigger>
          <PopoverContent className='w-[--radix-popper-anchor-width] p-0' align='start'>
            <Command shouldFilter={!onSearchChange}>
              {searchable && (
                <CommandInput
                  placeholder={searchPlaceholder ?? `Search ${columnHeader.toLowerCase()}...`}
                  value={effectiveSearchValue}
                  onValueChange={handleSearchChange}
                />
              )}
              <CommandList>
                <CommandEmpty>
                  {searchLoading ? (
                    <div className='flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground'>
                      <Loader2 className='h-3.5 w-3.5 animate-spin' />
                      Loading...
                    </div>
                  ) : (
                    <span className='text-xs text-muted-foreground'>
                      {searchEmptyMessage ?? 'No results.'}
                    </span>
                  )}
                </CommandEmpty>
                <CommandGroup>
                  <CommandItem
                    value='all'
                    onSelect={() => {
                      column.setFilterValue(undefined)
                      setComboboxOpen(false)
                    }}
                  >
                    <span className='truncate'>All</span>
                    {selectedValue === 'all' && <CheckIcon className='ml-auto h-4 w-4' />}
                  </CommandItem>
                  {options.map(option => (
                    <CommandItem
                      key={option.value}
                      value={`${option.value} ${option.label}`}
                      onSelect={() => {
                        column.setFilterValue(option.value)
                        setComboboxOpen(false)
                      }}
                    >
                      <span className='truncate'>{option.label}</span>
                      {selectedValue === option.value && <CheckIcon className='ml-auto h-4 w-4' />}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>
    )
  }

  return (
    <div className='w-full max-w-xs'>
      {!hideLabel && (
        <Label htmlFor={`${id}-input`} className='sr-only'>
          {columnHeader}
        </Label>
      )}
      <div className='flex gap-2'>
        <div className='relative flex-1'>
          <Input
            id={`${id}-input`}
            className='peer pl-9'
            value={inputValue}
            onChange={e => setInputValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                applyTextFilter()
              }
            }}
            placeholder={placeholder ?? `Search ${columnHeader.toLowerCase()}`}
            type='text'
          />
          <div className='text-muted-foreground/80 pointer-events-none absolute inset-y-0 left-0 flex items-center justify-center pl-3 peer-disabled:opacity-50'>
            <SearchIcon size={16} />
          </div>
        </div>
        <Button type='button' variant='secondary' onClick={applyTextFilter}>
          Search
        </Button>
      </div>
    </div>
  )
}
