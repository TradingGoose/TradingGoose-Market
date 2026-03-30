'use client'

import type { ColumnDef } from '@tanstack/react-table'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { TimeZoneRow } from './types'
import { TimeZoneRowActions } from './timezones-row-actions'

export function buildTimeZoneColumns(
  onEdit: (timeZone: TimeZoneRow) => void,
  onDelete: (timeZone: TimeZoneRow) => void
): ColumnDef<TimeZoneRow>[] {
  return [
    {
      id: 'select',
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && 'indeterminate')}
          onCheckedChange={value => table.toggleAllRowsSelected(!!value)}
          aria-label='Select all'
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={value => row.toggleSelected(!!value)}
          aria-label='Select row'
        />
      ),
      size: 36
    },
    {
      header: 'Time Zone ID',
      accessorKey: 'id',
      cell: ({ row }) => <span className='font-mono text-xs text-muted-foreground'>{row.original.id}</span>,
      size: 170
    },
    {
      header: 'Name',
      accessorKey: 'name',
      cell: ({ row }) => <span className='truncate'>{row.original.name}</span>,
      size: 260,
      enableSorting: true
    },
    {
      header: 'Offset',
      accessorKey: 'offset',
      cell: ({ row }) => {
        const { offset, offsetDst, observesDst } = row.original
        return (
          <div className='flex flex-wrap gap-1'>
            <Badge variant='secondary' className='font-mono text-xs'>
              STD {offset}
            </Badge>
            {observesDst ? (
              <Badge variant='outline' className='font-mono text-xs'>
                DST {offsetDst ?? '—'}
              </Badge>
            ) : null}
          </div>
        )
      },
      size: 160,
      enableSorting: true
    },
    {
      header: 'Observes DST',
      accessorKey: 'observesDst',
      cell: ({ row }) =>
        row.original.observesDst ? (
          <Badge variant='secondary' className='text-xs'>
            Yes
          </Badge>
        ) : (
          <Badge variant='outline' className='text-xs'>
            No
          </Badge>
        ),
      size: 120,
      enableSorting: true
    },
    {
      header: 'Updated',
      accessorKey: 'updatedAt',
      cell: ({ row }) => (row.original.updatedAt ? new Date(row.original.updatedAt).toLocaleString() : '—'),
      size: 180,
      enableSorting: true
    },
    {
      id: 'actions',
      header: () => 'Actions',
      cell: ({ row }) => <TimeZoneRowActions timeZone={row.original} onEdit={onEdit} onDelete={onDelete} />,
      size: 48,
      enableHiding: false
    }
  ]
}
