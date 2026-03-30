'use client'

import type { ColumnDef } from '@tanstack/react-table'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Checkbox } from '@/components/ui/checkbox'
import { CurrencyRow } from './types'
import { CurrencyRowActions } from './currencies-row-actions'

function renderCurrencyAvatar(code: string, iconUrl: string | null) {
  return (
    <Avatar className='h-10 w-10 rounded-sm bg-primary/5'>
      {iconUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={iconUrl} alt='' className='h-full w-full object-contain' />
      ) : (
        <AvatarFallback className='bg-primary/10 text-primary font-semibold uppercase'>
          {code.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      )}
    </Avatar>
  )
}

export function buildCurrencyColumns(
  onEdit: (currency: CurrencyRow) => void,
  onDelete: (currency: CurrencyRow) => void
): ColumnDef<CurrencyRow>[] {
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
      header: 'Currency ID',
      accessorKey: 'id',
      cell: ({ row }) => <span className='font-mono text-xs text-muted-foreground'>{row.original.id}</span>,
      size: 160
    },
    {
      header: 'Icon',
      id: 'icon',
      cell: ({ row }) => renderCurrencyAvatar(row.original.code, row.original.iconUrl),
      size: 80,
      enableSorting: false,
      enableHiding: true
    },
    {
      header: 'Code',
      accessorKey: 'code',
      cell: ({ row }) => <span className='font-medium tracking-tight uppercase'>{row.original.code}</span>,
      size: 90,
      meta: {
        filterVariant: 'select'
      }
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
      header: 'Updated',
      accessorKey: 'updatedAt',
      cell: ({ row }) => (row.original.updatedAt ? new Date(row.original.updatedAt).toLocaleString() : '—'),
      size: 180,
      enableSorting: true
    },
    {
      id: 'actions',
      header: () => 'Actions',
      cell: ({ row }) => <CurrencyRowActions currency={row.original} onEdit={onEdit} onDelete={onDelete} />,
      size: 48,
      enableHiding: false
    }
  ]
}
