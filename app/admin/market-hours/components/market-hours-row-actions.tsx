'use client'

import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import { EllipsisVerticalIcon, Trash2 } from 'lucide-react'
import { MarketHourRow } from './types'

type MarketHourRowActionsProps = {
  row: MarketHourRow
  onDelete?: (row: MarketHourRow) => void
}

export function MarketHourRowActions({ row, onDelete }: MarketHourRowActionsProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size='icon' variant='ghost' className='rounded-full p-2' aria-label='Market hour actions'>
          <EllipsisVerticalIcon className='h-4 w-4' aria-hidden='true' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end'>
        <DropdownMenuGroup>
          <DropdownMenuItem
            className='text-destructive focus:text-destructive'
            onSelect={() => {
              onDelete?.(row)
            }}
          >
            <Trash2 className='size-4' aria-hidden='true' />
            <span>Delete</span>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
