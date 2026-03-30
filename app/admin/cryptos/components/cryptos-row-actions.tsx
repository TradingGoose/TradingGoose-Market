'use client'

import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { EllipsisVerticalIcon } from 'lucide-react'
import { CryptoRow } from './types'
import { useCanEdit } from '@/lib/auth/role-context'

type CryptoRowActionsProps = {
  crypto: CryptoRow
  onEdit: (crypto: CryptoRow) => void
  onDelete?: (crypto: CryptoRow) => void
}

export function CryptoRowActions({ crypto, onEdit, onDelete }: CryptoRowActionsProps) {
  const canEdit = useCanEdit()
  if (!canEdit) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size='icon' variant='ghost' className='rounded-full p-2' aria-label='Crypto actions'>
          <EllipsisVerticalIcon className='h-4 w-4' aria-hidden='true' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start'>
        <DropdownMenuGroup>
          <DropdownMenuItem
            onSelect={event => {
              event.preventDefault()
              onEdit(crypto)
            }}
          >
            <span>Edit</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className='text-destructive focus:text-destructive'
            onSelect={event => {
              event.preventDefault()
              onDelete?.(crypto)
            }}
          >
            <span>Delete</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
