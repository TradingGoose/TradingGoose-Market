'use client'

import type { ColumnDef } from '@tanstack/react-table'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { CityRow } from './types'
import { CityRowActions } from './cities-row-actions'

export function buildCityColumns(
  onEdit: (city: CityRow) => void,
  onDelete: (city: CityRow) => void
): ColumnDef<CityRow>[] {
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
      header: 'City ID',
      accessorKey: 'id',
      cell: ({ row }) => <span className='font-mono text-xs text-muted-foreground'>{row.original.id}</span>,
      size: 160
    },
    {
      header: 'Name',
      accessorKey: 'name',
      cell: ({ row }) => <span className='truncate'>{row.original.name}</span>,
      size: 220,
      enableSorting: true,
      meta: {
        filterVariant: 'select'
      }
    },
    {
      header: 'Country',
      id: 'countryId',
      accessorFn: row => row.countryId ?? '—',
      cell: ({ row }) => {
        const code = row.original.countryCode
        const name = row.original.countryName
        return code ? (
          <div className='flex flex-col leading-tight'>
            <span className='font-medium'>{code}</span>
            {name ? <span className='text-xs uppercase tracking-wide text-muted-foreground'>{name}</span> : null}
          </div>
        ) : (
          <span className='text-muted-foreground'>—</span>
        )
      },
      size: 140,
      meta: {
        filterVariant: 'select'
      }
    },
    {
      header: 'Time Zone',
      id: 'timeZoneId',
      accessorFn: row => row.timeZoneId ?? '—',
      cell: ({ row }) =>
        row.original.timeZoneName ? (
          <div className='flex flex-col leading-tight'>
            <span className='font-medium'>{row.original.timeZoneName}</span>
            {row.original.timeZoneOffset ? (
              <span className='text-xs text-muted-foreground'>
                {row.original.timeZoneOffset}
                {row.original.timeZoneOffsetDst ? ` / ${row.original.timeZoneOffsetDst}` : ''}
              </span>
            ) : null}
          </div>
        ) : (
          <span className='text-muted-foreground'>—</span>
        ),
      size: 170,
      meta: {
        filterVariant: 'select'
      }
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
      cell: ({ row }) => <CityRowActions city={row.original} onEdit={onEdit} onDelete={onDelete} />,
      size: 48,
      enableHiding: false
    }
  ]
}
