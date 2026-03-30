'use client'

import type { ColumnDef } from '@tanstack/react-table'
import {
  Avatar,
  AvatarFallback
} from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { ListingRow } from './types'
import { ListingRowActions } from './listing-row-actions'

function renderListingAvatar(base: string, iconUrl: string | null) {
  return (
    <Avatar className='h-10 w-10 rounded-sm bg-primary/5'>
      {iconUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={iconUrl} alt='' className='h-full w-full object-contain' />
      ) : (
        <AvatarFallback className='bg-primary/10 text-primary font-semibold uppercase'>
          {base.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      )}
    </Avatar>
  )
}

export function buildListingColumns(
  onEdit: (listing: ListingRow) => void,
  onDelete: (listing: ListingRow) => void
): ColumnDef<ListingRow>[] {
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
      header: 'Asset ID',
      accessorKey: 'id',
      cell: ({ row }) => <span className='font-mono text-xs text-muted-foreground'>{row.original.id}</span>,
      size: 140
    },
    {
      header: 'Icon',
      id: 'icon',
      cell: ({ row }) => renderListingAvatar(row.original.base, row.original.iconUrl),
      size: 80,
      enableSorting: false,
      enableHiding: true
    },
    {
      header: 'Listing',
      accessorKey: 'base',
      cell: ({ row }) => (
        <div className='flex flex-col gap-1'>
          <span className='font-medium tracking-tight'>{row.original.base}</span>
        </div>
      ),
      size: 50
    },
    {
      header: 'Name',
      accessorKey: 'name',
      cell: ({ row }) =>
        row.original.name ? (
          <span className='truncate'>{row.original.name}</span>
        ) : (
          <span className='text-muted-foreground'>—</span>
        ),
      size: 240,
      enableSorting: true
    },
    {
      header: 'Asset Class',
      accessorKey: 'assetClass',
      cell: ({ row }) => (
        <Badge variant='outline' className='w-fit text-xs capitalize tracking-wide'>
          {row.original.assetClass === 'mutualfund' ? 'mutual funds' : row.original.assetClass}
        </Badge>
      ),
      size: 110,
      meta: {
        filterVariant: 'select',
        selectOptions: [
          { label: 'future', value: 'future' },
          { label: 'stock', value: 'stock' },
          { label: 'etf', value: 'etf' },
          { label: 'mutual funds', value: 'mutualfund' },
          { label: 'indice', value: 'indice' }
        ]
      }
    },
    {
      header: 'Country',
      accessorKey: 'countryId',
      cell: ({ row }) => {
        const countryName = row.original.countryName ?? row.original.countryCode
        const countryCode = row.original.countryCode

        if (!countryName && !countryCode) {
          return <span className='text-muted-foreground'>—</span>
        }

        return (
          <div className='flex flex-col leading-tight'>
            <span className='font-medium'>{countryCode}</span>
            {countryCode && (
              <span className='text-xs uppercase tracking-wide text-muted-foreground'>{countryName}</span>
            )}
          </div>
        )
      },
      size: 140,
      meta: {
        filterVariant: 'select'
      }
    },
    {
      header: 'Quote',
      accessorFn: row => row.quote ?? '—',
      id: 'quote',
      cell: ({ row }) => {
        const code = row.original.quote ?? '—'
        const name = row.original.quoteName
        return (
          <div className='flex flex-col leading-tight'>
            <span className='font-mono text-sm'>{code}</span>
            {name ? <span className='text-xs text-muted-foreground'>{name}</span> : null}
          </div>
        )
      },
      size: 130,
      meta: {
        filterVariant: 'select'
      }
    },
    {
      header: 'Market',
      accessorFn: row => row.marketId ?? '—',
      id: 'marketId',
      cell: ({ row }) => {
        const code = row.original.marketCode
        const name = row.original.marketName
        if (!code && !name) {
          return <span className='text-muted-foreground'>—</span>
        }
        return (
          <div className='flex flex-col leading-tight'>
            <span className='font-medium'>{code ?? row.original.marketId}</span>
            {name ? <span className='text-xs uppercase tracking-wide text-muted-foreground'>{name}</span> : null}
          </div>
        )
      },
      size: 170,
      meta: {
        filterVariant: 'select'
      }
    },
    {
      header: 'Active',
      accessorFn: row => (row.active ? 'Active' : 'Inactive'),
      id: 'active',
      cell: ({ row }) => (
        <Switch aria-label={`Active state for ${row.original.base}`} defaultChecked={row.original.active} className='h-5 w-10' disabled />
      ),
      size: 90,
      meta: {
        filterVariant: 'select'
      }
    },
    {
      id: 'actions',
      header: () => 'Actions',
      cell: ({ row }) => (
        <div>
          <ListingRowActions listing={row.original} onEdit={onEdit} onDelete={onDelete} />
        </div>
      ),
      size: 48,
      enableHiding: false
    }
  ]
}
