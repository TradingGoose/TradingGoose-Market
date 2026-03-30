'use client'

import { type ComponentPropsWithoutRef, type ReactNode } from 'react'

import { CheckIcon, ChevronsUpDownIcon, Loader2 } from 'lucide-react'

import AvatarUpload from '@/components/file-upload/avatar-upload'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { type FileWithPreview } from '@/hooks/use-file-upload'
import { cn } from '@/lib/ui/utils'

export type SearchableSelectOption = { value: string; label: string }

type EditDialogHeaderProps = {
  title: string
  description: ReactNode
  showRequired?: boolean
  requiredNote?: string
}

export function EditDialogHeader({
  title,
  description,
  showRequired = true,
  requiredNote = 'Fields with * are required.'
}: EditDialogHeaderProps) {
  return (
    <DialogHeader>
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription>
        {description}
        {showRequired ? <span className='mt-1 block text-xs text-muted-foreground'>{requiredNote}</span> : null}
      </DialogDescription>
    </DialogHeader>
  )
}

type EditDialogFooterProps = {
  onCancel: () => void
  onSubmit?: () => void
  submitLabel?: string
  submitDisabled?: boolean
  submitType?: 'submit' | 'button'
  cancelDisabled?: boolean
  loading?: boolean
  leftSlot?: ReactNode
}

export function EditDialogFooter({
  onCancel,
  onSubmit,
  submitLabel = 'Save changes',
  submitDisabled,
  submitType = 'submit',
  cancelDisabled,
  loading,
  leftSlot
}: EditDialogFooterProps) {
  return (
    <DialogFooter>
      {leftSlot}
      <Button type='button' variant='outline' onClick={onCancel} disabled={cancelDisabled}>
        Cancel
      </Button>
      <Button type={submitType} onClick={onSubmit} disabled={submitDisabled}>
        {loading && <Loader2 className='mr-2 h-4 w-4 animate-spin' />}
        {submitLabel}
      </Button>
    </DialogFooter>
  )
}

type FormErrorProps = {
  message?: string | null
  className?: string
}

export function FormError({ message, className }: FormErrorProps) {
  if (!message) return null
  return <p className={cn('text-sm text-destructive', className)}>{message}</p>
}

type IconUploadFieldProps = {
  label?: string
  isEdit: boolean
  defaultAvatar?: string
  onFileChange: (file: FileWithPreview | null) => void
  uploading?: boolean
  error?: string | null
  emptyMessage?: string
  maxSize?: number
  avatarKey?: string
  helperText?: ReactNode
  className?: string
}

export function IconUploadField({
  label = 'Icon',
  isEdit,
  defaultAvatar,
  onFileChange,
  uploading,
  error,
  emptyMessage = 'Save the record first to upload an icon.',
  maxSize = 512 * 1024,
  avatarKey,
  helperText,
  className
}: IconUploadFieldProps) {
  return (
    <div className={cn('space-y-2', className)}>
      <Label>{label}</Label>
      {isEdit ? (
        <>
          <AvatarUpload
            key={avatarKey}
            maxSize={maxSize}
            defaultAvatar={defaultAvatar}
            onFileChange={onFileChange}
            className='items-start'
          />
          {uploading && <p className='text-xs text-muted-foreground'>Uploading...</p>}
          {error && <p className='text-xs text-destructive'>{error}</p>}
        </>
      ) : (
        <p className='text-sm text-muted-foreground'>{emptyMessage}</p>
      )}
      {helperText ? <p className='text-xs text-muted-foreground'>{helperText}</p> : null}
    </div>
  )
}

type SearchableSelectProps = {
  value: string
  options: SearchableSelectOption[]
  placeholder: string
  onChange: (value: string) => void
  searchValue?: string
  onSearchChange?: (value: string) => void
  searchPlaceholder?: string
  loading?: boolean
  loadingMessage?: string
  emptyMessage?: string
  clearLabel?: string
  clearLabelClassName?: string
  showClear?: boolean
  disabled?: boolean
  buttonClassName?: string
  listClassName?: string
  open?: boolean
  onOpenChange?: (open: boolean) => void
  selectedLabel?: string
  shouldFilter?: boolean
  buttonProps?: Omit<ComponentPropsWithoutRef<typeof Button>, 'children' | 'onClick'>
}

export function SearchableSelect({
  value,
  options,
  placeholder,
  onChange,
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search...',
  loading,
  loadingMessage = 'Loading...',
  emptyMessage = 'No results.',
  clearLabel = 'Clear selection',
  clearLabelClassName = 'truncate',
  showClear = true,
  disabled,
  buttonClassName,
  listClassName,
  open,
  onOpenChange,
  selectedLabel,
  shouldFilter = false,
  buttonProps
}: SearchableSelectProps) {
  const selectedOption = options.find(option => option.value === value)
  const displayLabel = value ? selectedLabel ?? selectedOption?.label ?? value : placeholder
  const { className, variant, size, disabled: buttonDisabled, ...buttonRest } = buttonProps ?? {}
  const isDisabled = disabled || buttonDisabled

  const handleSelect = (nextValue: string) => {
    onChange(nextValue)
    onSearchChange?.('')
    onOpenChange?.(false)
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant={variant ?? 'outline'}
          size={size}
          className={cn('w-full justify-between', className, buttonClassName)}
          disabled={isDisabled}
          {...buttonRest}
        >
          <span className={cn('truncate', !value && 'text-muted-foreground')}>{displayLabel}</span>
          <ChevronsUpDownIcon className='ml-2 h-4 w-4 opacity-50' />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-[--radix-popper-anchor-width] p-0' align='start'>
        <Command shouldFilter={shouldFilter}>
          <CommandInput
            placeholder={searchPlaceholder}
            {...(onSearchChange
              ? { value: searchValue ?? '', onValueChange: onSearchChange }
              : {})}
          />
          <CommandList className={listClassName ?? 'max-h-64 overflow-y-auto'}>
            <CommandEmpty>
              {loading ? (
                <span className='flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground'>
                  <Loader2 className='h-3.5 w-3.5 animate-spin' />
                  {loadingMessage}
                </span>
              ) : (
                <span className='text-xs text-muted-foreground'>{emptyMessage}</span>
              )}
            </CommandEmpty>
            <CommandGroup>
              {showClear ? (
                <CommandItem value='__none__' onSelect={() => handleSelect('')}>
                  <span className={clearLabelClassName}>{clearLabel}</span>
                </CommandItem>
              ) : null}
              {options.map(option => (
                <CommandItem
                  key={option.value}
                  value={`${option.value} ${option.label}`}
                  onSelect={() => handleSelect(option.value)}
                >
                  <span className='truncate'>{option.label}</span>
                  {value === option.value && <CheckIcon className='ml-auto h-4 w-4' />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
