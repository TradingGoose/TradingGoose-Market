'use client'

import type { ColumnDef } from '@tanstack/react-table'
import {
  Avatar,
  AvatarFallback
} from '@/components/ui/avatar'
import { Checkbox } from '@/components/ui/checkbox'
import { CountryRow } from './types'
import { CountryRowActions } from './countries-row-actions'

function renderCountryAvatar(code: string, iconUrl: string | null) {
  const safeCode = code?.trim()
  const resolvedIconUrl = iconUrl?.trim() || null

  return (
    <Avatar className='h-10 w-10 rounded-sm bg-primary/5'>
      {resolvedIconUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={resolvedIconUrl} alt='' className='h-full w-full object-contain' />
      ) : (
        <AvatarFallback className='bg-primary/10 text-primary font-semibold uppercase'>
          {code.slice(0, 2).toUpperCase()}
        </AvatarFallback>
      )}
    </Avatar>
  )
}

export function buildCountryColumns(
  onEdit: (country: CountryRow) => void,
  onDelete: (country: CountryRow) => void
): ColumnDef<CountryRow>[] {
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
      header: 'Country ID',
      accessorKey: 'id',
      cell: ({ row }) => <span className='font-mono text-xs text-muted-foreground'>{row.original.id}</span>,
      size: 160
    },
    {
      header: 'Icon',
      id: 'icon',
      cell: ({ row }) => renderCountryAvatar(row.original.code, row.original.iconUrl),
      size: 80,
      enableSorting: false,
      enableHiding: true
    },
    {
      header: 'Code',
      accessorKey: 'code',
      cell: ({ row }) => <span className='font-medium tracking-tight uppercase'>{row.original.code}</span>,
      size: 80,
      meta: {
        filterVariant: 'select'
      }
    },
    {
      header: 'Name',
      accessorKey: 'name',
      cell: ({ row }) => <span className='truncate'>{row.original.name}</span>,
      size: 240,
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
      cell: ({ row }) => <CountryRowActions country={row.original} onEdit={onEdit} onDelete={onDelete} />,
      size: 48,
      enableHiding: false
    }
  ]
}
