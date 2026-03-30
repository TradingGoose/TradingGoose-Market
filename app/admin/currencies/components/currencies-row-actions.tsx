'use client'

import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { EllipsisVerticalIcon } from 'lucide-react'
import { CurrencyRow } from './types'
import { useCanEdit } from '@/lib/auth/role-context'

type CurrencyRowActionsProps = {
  currency: CurrencyRow
  onEdit: (currency: CurrencyRow) => void
  onDelete?: (currency: CurrencyRow) => void
}

export function CurrencyRowActions({ currency, onEdit, onDelete }: CurrencyRowActionsProps) {
  const canEdit = useCanEdit()
  if (!canEdit) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size='icon' variant='ghost' className='rounded-full p-2' aria-label='Currency actions'>
          <EllipsisVerticalIcon className='h-4 w-4' aria-hidden='true' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start'>
        <DropdownMenuGroup>
          <DropdownMenuItem
            onSelect={event => {
              event.preventDefault()
              onEdit(currency)
            }}
          >
            <span>Edit</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className='text-destructive focus:text-destructive'
            onSelect={event => {
              event.preventDefault()
              onDelete?.(currency)
            }}
          >
            <span>Delete</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
