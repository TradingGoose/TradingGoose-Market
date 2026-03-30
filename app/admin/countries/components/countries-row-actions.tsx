'use client'

import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { EllipsisVerticalIcon } from 'lucide-react'
import { CountryRow } from './types'
import { useCanEdit } from '@/lib/auth/role-context'

type CountryRowActionsProps = {
  country: CountryRow
  onEdit: (country: CountryRow) => void
  onDelete?: (country: CountryRow) => void
}

export function CountryRowActions({ country, onEdit, onDelete }: CountryRowActionsProps) {
  const canEdit = useCanEdit()
  if (!canEdit) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size='icon' variant='ghost' className='rounded-full p-2' aria-label='Country actions'>
          <EllipsisVerticalIcon className='h-4 w-4' aria-hidden='true' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start'>
        <DropdownMenuGroup>
          <DropdownMenuItem
            onSelect={event => {
              event.preventDefault()
              onEdit(country)
            }}
          >
            <span>Edit</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className='text-destructive focus:text-destructive'
            onSelect={event => {
              event.preventDefault()
              onDelete?.(country)
            }}
          >
            <span>Delete</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
