'use client'

import { useEffect, useId, useMemo, useState } from 'react'

import { CheckIcon, ChevronsUpDownIcon, Loader2, XIcon } from 'lucide-react'

import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList
} from '@/components/ui/command'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/ui/utils'

export type MultiDropdownOption = {
  value: string
  label: string
  shortLabel?: string
}

type MultiDropdownProps = {
  options: MultiDropdownOption[]
  value?: string[]
  defaultValue?: string[]
  onChange?: (value: string[]) => void
  label?: string
  placeholder?: string
  searchPlaceholder?: string
  emptyMessage?: string
  disabled?: boolean
  readOnly?: boolean
  maxBadgeCount?: number
  badgeVariant?: BadgeProps['variant']
  summaryVariant?: BadgeProps['variant']
  badgeClassName?: string
  summaryClassName?: string
  className?: string
  buttonClassName?: string
  searchValue?: string
  onSearchValueChange?: (value: string) => void
  searchLoading?: boolean
  searchEmptyMessage?: string
}

const MultiDropdown = ({
  options,
  value,
  defaultValue = [],
  onChange,
  label,
  placeholder = 'Select options',
  searchPlaceholder = 'Search...',
  emptyMessage = 'No results.',
  disabled = false,
  readOnly = false,
  maxBadgeCount,
  badgeVariant = 'outline',
  summaryVariant = 'outline',
  badgeClassName,
  summaryClassName,
  className,
  buttonClassName,
  searchValue,
  onSearchValueChange,
  searchLoading = false,
  searchEmptyMessage
}: MultiDropdownProps) => {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [internalValues, setInternalValues] = useState<string[]>(defaultValue)
  const [internalSearchValue, setInternalSearchValue] = useState('')
  const isControlled = value !== undefined
  const selectedValues = isControlled ? value : internalValues
  const canEdit = Boolean(onChange) && !readOnly && !disabled
  const effectiveSearchValue = searchValue ?? internalSearchValue

  useEffect(() => {
    if (!open && !onSearchValueChange) {
      setInternalSearchValue('')
    }
  }, [open, onSearchValueChange])

  const optionMap = useMemo(() => {
    const map = new Map<string, MultiDropdownOption>()
    options.forEach(option => map.set(option.value, option))
    return map
  }, [options])

  const displayValues = useMemo(() => {
    if (maxBadgeCount && selectedValues.length > maxBadgeCount) {
      return selectedValues.slice(0, maxBadgeCount)
    }
    return selectedValues
  }, [maxBadgeCount, selectedValues])

  const hiddenCount = Math.max(selectedValues.length - displayValues.length, 0)

  const updateValues = (next: string[]) => {
    if (!isControlled) {
      setInternalValues(next)
    }
    if (onChange) {
      onChange(next)
    }
  }

  const toggleSelection = (nextValue: string) => {
    if (!canEdit) return
    updateValues(
      selectedValues.includes(nextValue)
        ? selectedValues.filter(valueItem => valueItem !== nextValue)
        : [...selectedValues, nextValue]
    )
  }

  const removeSelection = (nextValue: string) => {
    if (!canEdit) return
    updateValues(selectedValues.filter(valueItem => valueItem !== nextValue))
  }

  const selectedOptions = displayValues.map(val => optionMap.get(val) ?? { value: val, label: val })

  return (
    <div className={cn('w-full space-y-1', className)}>
      {label ? <Label htmlFor={id}>{label}</Label> : null}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            variant='outline'
            role='combobox'
            aria-expanded={open}
            disabled={disabled}
            className={cn('h-auto min-h-10 w-full justify-between hover:bg-transparent', buttonClassName)}
          >
            <div className='flex flex-wrap items-center gap-1 [overflow-wrap:anywhere]'>
              {selectedOptions.length > 0 ? (
                <>
                  {selectedOptions.map(option => {
                    const displayLabel = option.shortLabel ?? option.label
                    return (
                      <Badge
                        key={option.value}
                        variant={badgeVariant}
                        className={cn('rounded-sm max-w-full whitespace-normal [overflow-wrap:anywhere]', badgeClassName)}
                      >
                        {displayLabel}
                        {canEdit ? (
                          <Button
                            variant='ghost'
                            size='icon'
                            className='size-4'
                            onClick={event => {
                              event.stopPropagation()
                              removeSelection(option.value)
                            }}
                            asChild
                          >
                            <span>
                              <XIcon className='size-3' />
                            </span>
                          </Button>
                        ) : null}
                      </Badge>
                    )
                  })}
                  {hiddenCount > 0 && (
                    <Badge variant={summaryVariant} className={cn('rounded-sm', summaryClassName)}>
                      +{hiddenCount}
                    </Badge>
                  )}
                </>
              ) : (
                <span className='text-muted-foreground'>{placeholder}</span>
              )}
            </div>
            <ChevronsUpDownIcon className='text-muted-foreground/80 shrink-0' aria-hidden='true' />
          </Button>
        </PopoverTrigger>
        <PopoverContent className='w-[--radix-popper-anchor-width] p-0'>
          <Command shouldFilter={!onSearchValueChange}>
            <CommandInput
              placeholder={searchPlaceholder}
              value={effectiveSearchValue}
              onValueChange={nextValue => {
                if (onSearchValueChange) {
                  onSearchValueChange(nextValue)
                } else {
                  setInternalSearchValue(nextValue)
                }
              }}
            />
            <CommandList className='max-h-64 overflow-y-auto'>
              <CommandEmpty>
                {searchLoading ? (
                  <span className='flex items-center justify-center gap-2 py-1 text-xs text-muted-foreground'>
                    <Loader2 className='h-3.5 w-3.5 animate-spin' />
                    Loading...
                  </span>
                ) : (
                  <span className='text-xs text-muted-foreground'>{searchEmptyMessage ?? emptyMessage}</span>
                )}
              </CommandEmpty>
              <CommandGroup>
                {options.map(option => (
                  <CommandItem
                    key={option.value}
                    value={`${option.value} ${option.label}`}
                    onSelect={() => toggleSelection(option.value)}
                  >
                    <span className='truncate'>{option.label}</span>
                    {selectedValues.includes(option.value) && <CheckIcon size={16} className='ml-auto' />}
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

export default MultiDropdown
