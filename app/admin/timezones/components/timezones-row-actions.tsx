'use client'

import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { EllipsisVerticalIcon } from 'lucide-react'
import { TimeZoneRow } from './types'
import { useCanEdit } from '@/lib/auth/role-context'

type TimeZoneRowActionsProps = {
  timeZone: TimeZoneRow
  onEdit: (timeZone: TimeZoneRow) => void
  onDelete?: (timeZone: TimeZoneRow) => void
}

export function TimeZoneRowActions({ timeZone, onEdit, onDelete }: TimeZoneRowActionsProps) {
  const canEdit = useCanEdit()
  if (!canEdit) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size='icon' variant='ghost' className='rounded-full p-2' aria-label='Time zone actions'>
          <EllipsisVerticalIcon className='h-4 w-4' aria-hidden='true' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start'>
        <DropdownMenuGroup>
          <DropdownMenuItem
            onSelect={event => {
              event.preventDefault()
              onEdit(timeZone)
            }}
          >
            <span>Edit</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            className='text-destructive focus:text-destructive'
            onSelect={event => {
              event.preventDefault()
              onDelete?.(timeZone)
            }}
          >
            <span>Delete</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
