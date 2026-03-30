'use client'

import type { ColumnDef } from '@tanstack/react-table'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { ExchangeRow } from './types'
import { ExchangeRowActions } from './exchanges-row-actions'

export function buildExchangeColumns(
  onEdit: (exchange: ExchangeRow) => void,
  onDelete: (exchange: ExchangeRow) => void
): ColumnDef<ExchangeRow>[] {
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
      header: 'Exchange ID',
      accessorKey: 'id',
      cell: ({ row }) => <span className='font-mono text-xs text-muted-foreground'>{row.original.id}</span>,
      size: 160
    },
    {
      header: 'MIC Code',
      accessorKey: 'mic',
      cell: ({ row }) => <span className='font-medium tracking-tight'>{row.original.mic}</span>,
      size: 110
    },
    {
      header: 'Name',
      accessorKey: 'name',
      cell: ({ row }) => row.original.name ?? <span className='text-muted-foreground'>—</span>,
      size: 200,
      enableSorting: true
    },
    {
      header: 'LEI',
      accessorKey: 'lei',
      cell: ({ row }) => row.original.lei ?? <span className='text-muted-foreground'>—</span>,
      size: 160
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
      size: 200
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
      size: 140,
      meta: {
        filterVariant: 'select'
      }
    },
    {
      header: 'Active',
      accessorFn: row => (row.active ? 'Active' : 'Inactive'),
      id: 'active',
      cell: ({ row }) => (
        <Switch aria-label={`Active state for ${row.original.mic}`} defaultChecked={row.original.active} className='h-5 w-10' disabled />
      ),
      size: 70,
      meta: {
        filterVariant: 'select'
      }
    },
    {
      header: 'Created',
      accessorKey: 'createdAt',
      cell: ({ row }) => (row.original.createdAt ? row.original.createdAt.slice(0, 10) : '—'),
      size: 140,
      enableSorting: true
    },
    {
      header: 'Expired',
      accessorKey: 'expiredAt',
      cell: ({ row }) => (row.original.expiredAt ? row.original.expiredAt.slice(0, 10) : '—'),
      size: 140,
      enableSorting: true
    },
    {
      id: 'actions',
      header: () => 'Actions',
      cell: ({ row }) => <ExchangeRowActions exchange={row.original} onEdit={onEdit} onDelete={onDelete} />,
      size: 48,
      enableHiding: false
    }
  ]
}
