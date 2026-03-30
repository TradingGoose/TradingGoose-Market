'use client'

import { useEffect, useState, type FormEvent } from 'react'

import { EditDialogFooter, EditDialogHeader, FormError, IconUploadField, SearchableSelect } from '@/components/edit-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { type FileWithPreview } from '@/hooks/use-file-upload'
import { CryptoRow } from './types'

type CryptoEditDialogProps = {
  crypto: CryptoRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (crypto: CryptoRow) => void
  mode?: 'edit' | 'create'
}

type CryptoFormState = {
  code: string
  name: string
  active: boolean
  contractAddresses: {
    chainId: string
    address: string
    contractType: string
  }[]
  iconUrl: string
}

export function CryptoEditDialog({ crypto, open, onOpenChange, onSave, mode = 'edit' }: CryptoEditDialogProps) {
  const cryptoId = crypto?.id?.trim() ?? ''
  const isEdit = mode === 'edit' && cryptoId.length > 0

  const [formState, setFormState] = useState<CryptoFormState>({
    code: '',
    name: '',
    active: true,
    contractAddresses: [{ chainId: '', address: '', contractType: '' }],
    iconUrl: ''
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [iconUploading, setIconUploading] = useState(false)
  const [iconError, setIconError] = useState<string | null>(null)
  const [chainSearch, setChainSearch] = useState('')
  const [chainOptions, setChainOptions] = useState<{ value: string; label: string }[]>([])
  const [chainLabelMap, setChainLabelMap] = useState<Record<string, string>>({})
  const [chainLoading, setChainLoading] = useState(false)
  const [chainError, setChainError] = useState<string | null>(null)
  const [chainOpenIndex, setChainOpenIndex] = useState<number | null>(null)

  useEffect(() => {
    if (!open) return
    if (crypto) {
      setFormState({
        code: crypto.code,
        name: crypto.name,
        active: crypto.active ?? true,
        contractAddresses:
          crypto.contractAddresses?.length > 0
            ? crypto.contractAddresses.map(contract => ({
                chainId: contract.chainId,
                address: contract.address ?? '',
                contractType: contract.contractType ?? ''
              }))
            : [{ chainId: '', address: '', contractType: '' }],
        iconUrl: crypto.iconUrl ?? ''
      })
      const labels: Record<string, string> = {}
      crypto.contractAddresses?.forEach(contract => {
        const code = contract.chainCode?.trim()
        const name = contract.chainName?.trim()
        const label = code && name ? `${code} — ${name}` : code || name
        if (label) {
          labels[contract.chainId] = label
        }
      })
      setChainLabelMap(labels)
    } else {
      setFormState({
        code: '',
        name: '',
        active: true,
        contractAddresses: [{ chainId: '', address: '', contractType: '' }],
        iconUrl: ''
      })
      setChainLabelMap({})
    }
    setError(null)
    setIconError(null)
    setChainSearch('')
  }, [crypto, open])

  useEffect(() => {
    if (!open) return

    const controller = new AbortController()
    const timeout = setTimeout(() => {
      setChainLoading(true)
      setChainError(null)

      const params = new URLSearchParams({ limit: '50' })
      const trimmed = chainSearch.trim()
      if (trimmed) params.set('query', trimmed)

      fetch(`/api/chains?${params.toString()}`, { signal: controller.signal })
        .then(async response => {
          if (!response.ok) throw new Error(`Request failed with ${response.status}`)
          const payload = (await response.json()) as { data: { id: string; code: string; name: string }[] }
          setChainOptions(payload.data.map(chain => ({ value: chain.id, label: `${chain.code} — ${chain.name}` })))
        })
        .catch(fetchError => {
          if (fetchError instanceof DOMException && fetchError.name === 'AbortError') return
          setChainError('Unable to load chains.')
          setChainOptions([])
        })
        .finally(() => setChainLoading(false))
    }, 200)

    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [chainSearch, open])

  const isFormValid =
    formState.code.trim().length >= 1 &&
    formState.name.trim().length > 0 &&
    formState.contractAddresses.length > 0 &&
    formState.contractAddresses.every(contract => contract.chainId.trim().length > 0) &&
    !saving

  const handleIconUpload = async (file: File) => {
    if (!crypto || !cryptoId) {
      setIconError('Save the crypto before uploading an icon.')
      return
    }

    setIconError(null)
    setIconUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('cryptoId', cryptoId)
      formData.append('code', formState.code || crypto.code)

      const response = await fetch('/api/uploads/crypto-icon', {
        method: 'POST',
        body: formData
      })

      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body?.error ?? 'Failed to upload icon.')
      }

      const payload = (await response.json()) as { data: { url: string } }
      setFormState(prev => ({ ...prev, iconUrl: payload.data.url }))
      onSave({ ...crypto, iconUrl: payload.data.url })
    } catch (uploadErr) {
      setIconError(uploadErr instanceof Error ? uploadErr.message : 'Failed to upload icon.')
    } finally {
      setIconUploading(false)
    }
  }

  const handleAvatarChange = (fileWithPreview: FileWithPreview | null) => {
    if (!fileWithPreview) {
      setFormState(prev => ({ ...prev, iconUrl: '' }))
      return
    }
    const rawFile = fileWithPreview.file
    if (rawFile instanceof File) {
      void handleIconUpload(rawFile)
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!formState.code.trim() || !formState.name.trim()) {
      setError('Code and name are required.')
      return
    }

    if (formState.contractAddresses.some(contract => !contract.chainId.trim())) {
      setError('Each contract must have a chain selected.')
      return
    }

    if (formState.contractAddresses.length === 0) {
      setError('At least one contract is required.')
      return
    }

    if (mode === 'edit' && !cryptoId) {
      setError('Crypto id is required.')
      return
    }

    try {
      setSaving(true)
      setError(null)
      const trimmedIconUrl = formState.iconUrl.trim()
      const iconUrlPayload = trimmedIconUrl ? undefined : null
      const contracts = formState.contractAddresses.map(contract => ({
        chainId: contract.chainId.trim(),
        address: contract.address.trim(),
        contractType: contract.contractType.trim()
      }))
      const contractKeyed = new Map<string, (typeof contracts)[number]>()
      contracts.forEach(contract => {
        const key = `${contract.chainId}||${contract.address}||${contract.contractType}`
        if (!contractKeyed.has(key)) {
          contractKeyed.set(key, contract)
        }
      })
      const payload = {
        code: formState.code.trim(),
        name: formState.name.trim(),
        active: formState.active,
        contractAddresses: Array.from(contractKeyed.values()),
        iconUrl: iconUrlPayload
      }

      const response = isEdit
        ? await fetch(`/api/cryptos/${cryptoId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          })
        : await fetch(`/api/cryptos`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          })

      if (!response.ok) {
        const message = await response
          .json()
          .then(body => body?.error ?? 'Failed to save crypto.')
          .catch(() => 'Failed to save crypto.')
        throw new Error(message)
      }

      const result = (await response.json()) as { data: CryptoRow | null }
      if (!result.data) {
        throw new Error('Crypto could not be loaded after save.')
      }

      onSave(result.data)
      onOpenChange(false)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to save crypto.')
    } finally {
      setSaving(false)
    }
  }

  const handleContractChange = (
    index: number,
    next: Partial<CryptoFormState['contractAddresses'][number]>
  ) => {
    if (next.chainId) {
      const label = chainOptions.find(option => option.value === next.chainId)?.label
      if (label) {
        setChainLabelMap(prev => ({ ...prev, [next.chainId!]: label }))
      }
    }
    setFormState(prev => {
      const updated = [...prev.contractAddresses]
      updated[index] = { ...updated[index], ...next }
      return { ...prev, contractAddresses: updated }
    })
  }

  const handleAddContract = () => {
    setFormState(prev => ({
      ...prev,
      contractAddresses: [...prev.contractAddresses, { chainId: '', address: '', contractType: '' }]
    }))
  }

  const handleRemoveContract = (index: number) => {
    setFormState(prev => {
      if (prev.contractAddresses.length <= 1) return prev
      const updated = prev.contractAddresses.filter((_, idx) => idx !== index)
      return { ...prev, contractAddresses: updated }
    })
  }

  return (
    <Dialog open={open} onOpenChange={nextOpen => onOpenChange(nextOpen)}>
      <DialogContent className='max-w-2xl'>
        <EditDialogHeader
          title={isEdit ? 'Edit Crypto' : 'Add Crypto'}
          description={isEdit ? 'Update crypto details.' : 'Create a new crypto asset.'}
        />
        <form className='space-y-6' onSubmit={handleSubmit}>
          <div className='grid gap-4 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label htmlFor='crypto-code'>Code <span className='text-destructive'>*</span></Label>
              <Input
                id='crypto-code'
                value={formState.code}
                onChange={event => setFormState(prev => ({ ...prev, code: event.target.value.toUpperCase() }))}
                placeholder='e.g., BTC'
                required
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='crypto-name'>Name <span className='text-destructive'>*</span></Label>
              <Input
                id='crypto-name'
                value={formState.name}
                onChange={event => setFormState(prev => ({ ...prev, name: event.target.value }))}
                placeholder='Bitcoin'
                required
              />
            </div>
          </div>

          <div className='space-y-3'>
            <div className='flex items-center justify-between'>
              <Label>Contracts <span className='text-destructive'>*</span></Label>
              <Button type='button' variant='outline' size='sm' onClick={handleAddContract}>
                Add contract
              </Button>
            </div>
            <div className='space-y-3'>
              {formState.contractAddresses.map((contract, index) => {
                const selectedChainLabel = contract.chainId
                  ? chainOptions.find(option => option.value === contract.chainId)?.label ??
                    chainLabelMap[contract.chainId] ??
                    contract.chainId
                  : ''
                const isChainOpen = chainOpenIndex === index

                return (
                  <div key={`contract-${index}`} className='grid gap-3 md:grid-cols-[1.2fr,1fr,1.6fr,auto]'>
                    <div className='space-y-2'>
                      <Label htmlFor={`crypto-chain-${index}`}>Chain <span className='text-destructive'>*</span></Label>
                      <SearchableSelect
                        value={contract.chainId}
                        placeholder='Select chain'
                        options={chainOptions}
                        searchValue={chainSearch}
                        onSearchChange={setChainSearch}
                        searchPlaceholder='Search chains...'
                        loading={chainLoading}
                        emptyMessage={chainError ?? 'No chains found.'}
                        showClear={false}
                        open={isChainOpen}
                        onOpenChange={open => setChainOpenIndex(open ? index : null)}
                        onChange={value => handleContractChange(index, { chainId: value })}
                        buttonProps={{
                          id: `crypto-chain-${index}`,
                          role: 'combobox',
                          'aria-expanded': isChainOpen
                        }}
                        selectedLabel={selectedChainLabel}
                      />
                    </div>
                    <div className='space-y-2'>
                      <Label htmlFor={`crypto-contract-type-${index}`}>Contract Type</Label>
                      <Input
                        id={`crypto-contract-type-${index}`}
                        value={contract.contractType}
                        onChange={event => handleContractChange(index, { contractType: event.target.value })}
                        placeholder='e.g., ERC-20'
                      />
                    </div>
                    <div className='space-y-2'>
                      <Label htmlFor={`crypto-address-${index}`}>Address</Label>
                      <Input
                        id={`crypto-address-${index}`}
                        value={contract.address}
                        onChange={event => handleContractChange(index, { address: event.target.value })}
                        placeholder='Contract address (optional)'
                      />
                    </div>
                    <div className='flex items-end'>
                      <Button
                        type='button'
                        variant='ghost'
                        onClick={() => handleRemoveContract(index)}
                        disabled={formState.contractAddresses.length <= 1}
                        aria-label='Remove contract'
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className='space-y-2'>
            <Label>Crypto status</Label>
            <div className='flex items-center justify-between rounded-md border px-3 py-2'>
              <div className='space-y-0.5'>
                <p className='text-sm font-medium leading-none'>Active</p>
                <p className='text-xs text-muted-foreground'>Toggle to enable or disable the crypto.</p>
              </div>
              <Switch
                checked={formState.active}
                onCheckedChange={checked => setFormState(prev => ({ ...prev, active: checked }))}
              />
            </div>
          </div>

          <IconUploadField
            isEdit={isEdit}
            defaultAvatar={formState.iconUrl || undefined}
            onFileChange={handleAvatarChange}
            uploading={iconUploading}
            error={iconError}
            emptyMessage='Save the crypto first to upload an icon.'
          />

          <FormError message={error} />

          <EditDialogFooter
            onCancel={() => onOpenChange(false)}
            submitDisabled={!isFormValid}
            cancelDisabled={saving}
            loading={saving}
          />
        </form>
      </DialogContent>
    </Dialog>
  )
}
