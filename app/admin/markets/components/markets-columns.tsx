'use client'

import type { ColumnDef } from '@tanstack/react-table'
import { Checkbox } from '@/components/ui/checkbox'
import { MarketRow } from './types'
import { MarketRowActions } from './markets-row-actions'

export function buildMarketColumns(
  onEdit: (market: MarketRow) => void,
  onDelete: (market: MarketRow) => void
): ColumnDef<MarketRow>[] {
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
      header: 'Market ID',
      accessorKey: 'id',
      cell: ({ row }) => <span className='font-mono text-xs text-muted-foreground'>{row.original.id}</span>,
      size: 160
    },
    {
      header: 'Code',
      accessorKey: 'code',
      cell: ({ row }) => <span className='font-medium tracking-tight'>{row.original.code}</span>,
      size: 90
    },
    {
      header: 'Name',
      accessorKey: 'name',
      cell: ({ row }) => <span className='truncate'>{row.original.name}</span>,
      size: 220,
      enableSorting: true
    },
    {
      header: 'URL',
      accessorKey: 'url',
      cell: ({ row }) =>
        row.original.url ? (
          <span className='truncate text-xs text-muted-foreground'>{row.original.url}</span>
        ) : (
          <span className='text-muted-foreground'>—</span>
        ),
      size: 220
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
      header: 'City',
      id: 'cityId',
      accessorFn: row => row.cityId ?? '—',
      cell: ({ row }) => row.original.cityName ?? '—',
      size: 150,
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
      id: 'actions',
      header: () => 'Actions',
      cell: ({ row }) => <MarketRowActions market={row.original} onEdit={onEdit} onDelete={onDelete} />,
      size: 48,
      enableHiding: false
    }
  ]
}
