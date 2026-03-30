'use client'

import type { ColumnDef } from '@tanstack/react-table'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { CryptoRow } from './types'
import { CryptoRowActions } from './cryptos-row-actions'

function getChainLabel(contract: CryptoRow['contractAddresses'][number]) {
  if (contract.chainCode) return contract.chainCode
  if (contract.chainName) return contract.chainName
  return contract.chainId.replace(/^TG_CHAN_/, '')
}

function summarizeChains(contracts: CryptoRow['contractAddresses']) {
  const labels = Array.from(new Set(contracts.map(getChainLabel).filter(Boolean)))
  if (!labels.length) return { primary: '—', secondary: null }
  const [primary, ...rest] = labels
  const secondary = labels.length === 1 ? null : `${labels.length} chains`
  return { primary: rest.length ? `${primary} +${rest.length}` : primary, secondary }
}

function summarizeAddresses(contracts: CryptoRow['contractAddresses']) {
  const addresses = contracts.map(contract => contract.address).filter(address => address)
  if (!addresses.length) return null
  if (addresses.length === 1) return addresses[0]
  return `${addresses.length} addresses`
}

function summarizeContractTypes(contracts: CryptoRow['contractAddresses']) {
  const types = Array.from(
    new Set(contracts.map(contract => contract.contractType).filter(type => type))
  )
  if (!types.length) return null
  if (types.length === 1) return types[0]
  return 'Multiple'
}

function renderCryptoAvatar(code: string, iconUrl: string | null) {
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

export function buildCryptoColumns(
  onEdit: (crypto: CryptoRow) => void,
  onDelete: (crypto: CryptoRow) => void
): ColumnDef<CryptoRow>[] {
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
      header: 'Crypto ID',
      accessorKey: 'id',
      cell: ({ row }) => <span className='font-mono text-xs text-muted-foreground'>{row.original.id}</span>,
      size: 160
    },
    {
      header: 'Icon',
      id: 'icon',
      cell: ({ row }) => renderCryptoAvatar(row.original.code, row.original.iconUrl),
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
      size: 200,
      enableSorting: true
    },
    {
      header: 'Asset Type',
      accessorKey: 'assetType',
      cell: ({ row }) => {
        const assetType = row.original.assetType?.trim()
        return assetType ? (
          <Badge variant='outline' className='text-xs capitalize'>
            {assetType}
          </Badge>
        ) : (
          <span className='text-muted-foreground'>—</span>
        )
      },
      size: 120,
      meta: {
        filterVariant: 'select',
        selectOptions: [
          { label: 'coin', value: 'coin' },
          { label: 'token', value: 'token' }
        ]
      }
    },
    {
      header: 'Chains',
      id: 'chainId',
      accessorFn: row => row.contractAddresses.map(contract => contract.chainId).join(','),
      cell: ({ row }) => {
        const summary = summarizeChains(row.original.contractAddresses)

        return (
          <div className='flex flex-col leading-tight'>
            <span className='font-medium'>{summary.primary}</span>
            {summary.secondary ? (
              <span className='text-xs text-muted-foreground'>{summary.secondary}</span>
            ) : null}
          </div>
        )
      },
      size: 160,
      meta: {
        filterVariant: 'select'
      }
    },
    {
      header: 'Address',
      id: 'addresses',
      accessorFn: row => row.contractAddresses.map(contract => contract.address).join(','),
      cell: ({ row }) => {
        const summary = summarizeAddresses(row.original.contractAddresses)
        return summary ? (
          <span className='font-mono text-xs text-muted-foreground'>{summary}</span>
        ) : (
          <span className='text-muted-foreground'>—</span>
        )
      },
      size: 220,
      enableSorting: false
    },
    {
      header: 'Contract',
      id: 'contractTypes',
      accessorFn: row => row.contractAddresses.map(contract => contract.contractType).join(','),
      cell: ({ row }) => {
        const summary = summarizeContractTypes(row.original.contractAddresses)
        return summary ? (
          <Badge variant='outline' className='text-xs capitalize'>
            {summary}
          </Badge>
        ) : (
          <span className='text-muted-foreground'>—</span>
        )
      },
      size: 140,
      enableSorting: false
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
      cell: ({ row }) => <CryptoRowActions crypto={row.original} onEdit={onEdit} onDelete={onDelete} />,
      size: 48,
      enableHiding: false
    }
  ]
}
