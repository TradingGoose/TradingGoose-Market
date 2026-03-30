'use client'

import type { ColumnDef } from '@tanstack/react-table'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { MarketHourRow } from './types'
import { MarketHourRowActions } from './market-hours-row-actions'

function summarizeSessions(hours: any) {
  const summary = new Map<string, number>()
  const sessions = hours?.sessions
  if (sessions && typeof sessions === 'object') {
    Object.values(sessions as Record<string, any[]>).forEach(daySessions => {
      if (Array.isArray(daySessions)) {
        daySessions.forEach(entry => {
          const state = typeof entry?.state === 'string' && entry.state.trim() ? entry.state.trim().toLowerCase() : 'session'
          summary.set(state, (summary.get(state) ?? 0) + 1)
        })
      }
    })
  }
  return Array.from(summary.entries()).map(([state, count]) => ({ state, count }))
}

export function buildMarketHoursColumns(
  onEdit: (row: MarketHourRow) => void,
  onDelete: (row: MarketHourRow) => void
): ColumnDef<MarketHourRow>[] {
  return [
    {
      header: 'Search',
      id: 'q',
      accessorFn: row =>
        `${row.id} ${row.marketCode ?? ''} ${row.marketName ?? ''} ${row.listingBase ?? ''} ${row.countryCode ?? ''} ${row.countryName ?? ''} ${row.cityName ?? ''}`,
      enableSorting: false,
      enableHiding: true,
      size: 0,
      meta: {
        filterVariant: 'text'
      }
    },
    {
      header: 'Country Filter',
      id: 'countryId',
      accessorFn: row => row.countryId ?? '',
      enableSorting: false,
      enableHiding: true,
      size: 0,
      meta: { filterVariant: 'select' }
    },
    {
      header: 'Market Filter',
      id: 'marketId',
      accessorFn: row => row.marketId ?? '',
      enableSorting: false,
      enableHiding: true,
      size: 0,
      meta: { filterVariant: 'select' }
    },
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
      header: 'Country',
      accessorKey: 'countryCode',
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
      meta: { filterVariant: 'select' }
    },
    {
      header: 'City',
      accessorKey: 'cityName',
      cell: ({ row }) => row.original.cityName ?? '—',
      size: 160,
      meta: { filterVariant: 'select' }
    },
    {
      header: 'Asset Class',
      accessorKey: 'assetClass',
      cell: ({ row }) =>
        row.original.assetClass ? (
          <Badge variant='outline' className='capitalize text-xs'>
            {row.original.assetClass === 'mutualfund' ? 'mutual funds' : row.original.assetClass}
          </Badge>
        ) : (
          <span className='text-muted-foreground'>—</span>
        ),
      size: 110,
      meta: {
        filterVariant: 'select',
        selectOptions: [
          { label: 'crypto', value: 'crypto' },
          { label: 'future', value: 'future' },
          { label: 'stock', value: 'stock' },
          { label: 'etf', value: 'etf' },
          { label: 'currency', value: 'currency' },
          { label: 'mutual funds', value: 'mutualfund' },
          { label: 'indice', value: 'indice' }
        ]
      }
    },
    {
      header: 'Market',
      accessorKey: 'marketCode',
      cell: ({ row }) => {
        const code = row.original.marketCode
        const name = row.original.marketName
        return code ? (
          <div className='flex flex-col leading-tight'>
            <span className='font-medium'>{code}</span>
            {name ? <span className='text-xs uppercase tracking-wide text-muted-foreground'>{name}</span> : null}
          </div>
        ) : (
          <span className='text-muted-foreground'>—</span>
        )
      },
      size: 110,
      meta: { filterVariant: 'select' }
    },
    {
      header: 'Listing',
      accessorKey: 'listingBase',
      cell: ({ row }) => row.original.listingBase ?? '—',
      size: 140
    },
    {
      header: 'Time zone',
      accessorKey: 'timeZoneName',
      cell: ({ row }) => (
        <div className='flex flex-col leading-tight'>
          <span className='truncate'>{row.original.timeZoneName ?? '—'}</span>
          {row.original.timeZoneOffset ? (
            <span className='text-xs text-muted-foreground'>
              {row.original.timeZoneOffset}
              {row.original.timeZoneOffsetDst ? ` / ${row.original.timeZoneOffsetDst}` : ''}
            </span>
          ) : null}
        </div>
      ),
      size: 160,
      meta: { filterVariant: 'select' }
    },
    {
      header: 'Sessions',
      accessorKey: 'sessionsCount',
      cell: ({ row }) => {
        const perState = summarizeSessions(row.original.hours)
        if (perState.length === 0) {
          return (
            <Badge variant='secondary' className='text-xs'>
              {row.original.sessionsCount} sessions
            </Badge>
          )
        }
        return (
          <div className='flex flex-wrap gap-1'>
            {perState.map(({ state, count }) => (
              <Badge key={state} variant='secondary' className='text-[11px]'>
                {state} ({count})
              </Badge>
            ))}
          </div>
        )
      },
      size: 110
    },
    {
      header: 'Holidays',
      accessorKey: 'holidaysCount',
      cell: ({ row }) => (
        <Badge variant='outline' className='text-xs'>
          {row.original.holidaysCount} holidays
        </Badge>
      ),
      size: 110
    },
    {
      id: 'actions',
      header: () => 'Actions',
      cell: ({ row }) => <MarketHourRowActions row={row.original} onEdit={onEdit} onDelete={onDelete} />,
      size: 48,
      enableHiding: false
    }
  ]
}
