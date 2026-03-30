'use client'

import { useEffect, useMemo, useState, type FormEvent } from 'react'

import { EditDialogFooter, EditDialogHeader, FormError, IconUploadField, SearchableSelect } from '@/components/edit-dialog'
import {
  Dialog,
  DialogContent
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { type FileWithPreview } from '@/hooks/use-file-upload'
import { ListingRow } from './types'

type ListingEditDialogProps = {
  listing: ListingRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (listing: ListingRow) => void
  mode?: 'edit' | 'create'
}

type ListingFormState = {
  base: string
  quote: string
  quoteName: string | null
  name: string
  assetClass: string
  marketId: string
  marketLabel: string
  active: boolean
  iconUrl: string | null
}

const isSameFormState = (a: ListingFormState, b: ListingFormState) =>
  a.base === b.base &&
  a.quote === b.quote &&
  a.quoteName === b.quoteName &&
  a.name === b.name &&
  a.assetClass === b.assetClass &&
  a.marketId === b.marketId &&
  a.marketLabel === b.marketLabel &&
  a.active === b.active &&
  a.iconUrl === b.iconUrl

const assetClassOptions = [
  { label: 'future', value: 'future' },
  { label: 'stock', value: 'stock' },
  { label: 'etf', value: 'etf' },
  { label: 'mutual funds', value: 'mutualfund' },
  { label: 'indice', value: 'indice' }
]

export function ListingEditDialog({ listing, open, onOpenChange, onSave, mode = 'edit' }: ListingEditDialogProps) {
  const isEdit = mode === 'edit' && !!listing

  const [formState, setFormState] = useState<ListingFormState>({
    base: '',
    quote: '',
    quoteName: null,
    name: '',
    assetClass: '',
    marketId: '',
    marketLabel: '',
    active: true,
    iconUrl: null
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [marketSearch, setMarketSearch] = useState('')
  const [marketOptions, setMarketOptions] = useState<{ id: string; code: string; name: string | null }[]>([])
  const [marketLoading, setMarketLoading] = useState(false)
  const [marketError, setMarketError] = useState<string | null>(null)
  const [currencySearch, setCurrencySearch] = useState('')
  const [currencyOptions, setCurrencyOptions] = useState<{ value: string; label: string; name?: string }[]>([])
  const [currencyLoading, setCurrencyLoading] = useState(false)
  const [currencyError, setCurrencyError] = useState<string | null>(null)
  const [iconUploading, setIconUploading] = useState(false)
  const [iconError, setIconError] = useState<string | null>(null)
  const [assetClassOpen, setAssetClassOpen] = useState(false)

  useEffect(() => {
    if (!open) return

    const marketLabel = listing?.marketCode
      ? listing.marketName
        ? `${listing.marketCode} — ${listing.marketName}`
        : listing.marketCode
      : listing?.marketName ?? ''

    const nextState: ListingFormState = listing
      ? {
        base: listing.base,
        quote: listing.quote ?? '',
        quoteName: listing.quoteName,
        name: listing.name ?? '',
        assetClass: listing.assetClass ?? '',
        marketId: listing.marketId ?? '',
        marketLabel,
        active: listing.active,
        iconUrl: listing.iconUrl ?? null
      }
      : {
        base: '',
        quote: '',
        quoteName: null,
        name: '',
        assetClass: '',
        marketId: '',
        marketLabel: '',
        active: true,
        iconUrl: null
      }

    setFormState(prev => (isSameFormState(prev, nextState) ? prev : nextState))

    setError(null)
    setMarketSearch('')
    setCurrencySearch('')
  }, [listing, open])

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      setCurrencyLoading(true)
      setCurrencyError(null)
      const params = new URLSearchParams({ limit: '50' })
      const trimmed = currencySearch.trim()
      if (trimmed) params.set('query', trimmed)

      fetch(`/api/currencies?${params.toString()}`, { signal: controller.signal })
        .then(async response => {
          if (!response.ok) throw new Error(`Request failed with ${response.status}`)
          const payload = (await response.json()) as { data: { code: string; name: string }[] }
          setCurrencyOptions(payload.data.map(c => ({ value: c.code, label: `${c.code} — ${c.name}`, name: c.name })))
        })
        .catch(fetchError => {
          if (fetchError instanceof DOMException && fetchError.name === 'AbortError') return
          setCurrencyError('Unable to load currencies.')
          setCurrencyOptions([])
        })
        .finally(() => setCurrencyLoading(false))
    }, 200)

    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [currencySearch, open])

  const currencyOptionMap = useMemo(() => new Map(currencyOptions.map(option => [option.value, option])), [currencyOptions])
  const currencyDropdownOptions = useMemo(
    () => currencyOptions.map(({ value, label }) => ({ value, label })),
    [currencyOptions]
  )
  const selectedQuoteLabel = useMemo(() => {
    if (!formState.quote) return undefined
    return currencyOptionMap.get(formState.quote)?.label ?? formState.quote
  }, [currencyOptionMap, formState.quote])

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      setMarketLoading(true)
      setMarketError(null)
      const params = new URLSearchParams({ limit: '200' })
      const trimmed = marketSearch.trim()
      if (trimmed) params.set('query', trimmed)

      fetch(`/api/markets?${params.toString()}`, { signal: controller.signal })
        .then(async response => {
          if (!response.ok) {
            throw new Error(`Request failed with ${response.status}`)
          }
          const payload = (await response.json()) as { data: { id: string; code: string; name: string | null }[] }
          setMarketOptions(payload.data)
        })
        .catch(fetchError => {
          if (fetchError instanceof DOMException && fetchError.name === 'AbortError') {
            return
          }
          setMarketError('Unable to load markets.')
          setMarketOptions([])
        })
        .finally(() => {
          setMarketLoading(false)
        })
    }, 200)

    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [marketSearch, open])

  useEffect(() => {
    if (!open || !formState.marketId) return
    const exists = marketOptions.some(option => option.id === formState.marketId)
    if (exists) return

    const controller = new AbortController()
    fetch(`/api/markets?page=1&pageSize=1&id=${encodeURIComponent(formState.marketId)}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(`Request failed with ${response.status}`)
        const payload = (await response.json()) as { data: { id: string; code: string; name: string | null }[] }
        const selected = payload.data?.[0]
        if (!selected) return
        setMarketOptions(prev => {
          if (prev.some(option => option.id === selected.id)) return prev
          return [...prev, selected]
        })
        if (!formState.marketLabel) {
          const label = selected.name ? `${selected.code} — ${selected.name}` : selected.code
          setFormState(prev => ({ ...prev, marketLabel: label }))
        }
      })
      .catch(fetchError => {
        if (fetchError instanceof DOMException && fetchError.name === 'AbortError') return
      })

    return () => controller.abort()
  }, [open, formState.marketId, formState.marketLabel, marketOptions])

  const marketOptionMap = useMemo(
    () => new Map(marketOptions.map(option => [option.id, option])),
    [marketOptions]
  )
  const marketDropdownOptions = useMemo(
    () =>
      marketOptions.map(option => ({
        value: option.id,
        label: option.name ? `${option.code} — ${option.name}` : option.code
      })),
    [marketOptions]
  )
  const selectedMarketLabel = useMemo(() => {
    if (!formState.marketId) return undefined
    const option = marketOptionMap.get(formState.marketId)
    if (option) {
      return option.name ? `${option.code} — ${option.name}` : option.code
    }
    return formState.marketLabel || formState.marketId
  }, [formState.marketId, formState.marketLabel, marketOptionMap])

  const isFormValid = formState.base.trim().length > 0 && !saving

  const handleIconUpload = async (file: File) => {
    if (!listing) {
      setIconError('Save the listing before uploading an icon.')
      return
    }

    setIconError(null)
    setIconUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('listing_id', listing.id)
      formData.append('base', formState.base)

      const response = await fetch('/api/uploads/listing-icon', {
        method: 'POST',
        body: formData
      })

      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body?.error ?? 'Failed to upload icon.')
      }

      const payload = (await response.json()) as { data: { url: string } }
      setFormState(prev => ({ ...prev, iconUrl: payload.data.url }))
    } catch (uploadErr) {
      setIconError(uploadErr instanceof Error ? uploadErr.message : 'Failed to upload icon.')
    } finally {
      setIconUploading(false)
    }
  }

  const handleAvatarChange = (fileWithPreview: FileWithPreview | null) => {
    if (!fileWithPreview) {
      setFormState(prev => (prev.iconUrl === null ? prev : { ...prev, iconUrl: null }))
      return
    }
    const rawFile = fileWithPreview.file
    if (rawFile instanceof File) {
      void handleIconUpload(rawFile)
    }
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!formState.base.trim()) {
      setError('Asset base is required.')
      return
    }

    try {
      setSaving(true)
      setError(null)
      const iconUrlPayload = formState.iconUrl ? undefined : null
      const payload = {
        base: formState.base.trim(),
        quote: formState.quote.trim() || null,
        name: formState.name.trim() || null,
        marketId: formState.marketId.trim() || null,
        active: formState.active,
        assetClass: formState.assetClass || undefined,
        iconUrl: iconUrlPayload,
        quoteName: formState.quoteName
      }

      const response = isEdit
        ? await fetch(`/api/listings/${listing!.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })
        : await fetch(`/api/listings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        })

      if (!response.ok) {
        const message = await response
          .json()
          .then(body => body?.error ?? 'Failed to update listing.')
          .catch(() => 'Failed to update listing.')
        throw new Error(message)
      }

      const result = (await response.json()) as { data: ListingRow | null }
      if (!result.data) {
        throw new Error('Listing could not be loaded after save.')
      }

      onSave(result.data)
      onOpenChange(false)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to save listing.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={nextOpen => onOpenChange(nextOpen)}>
      <DialogContent className='max-w-3xl'>
        <EditDialogHeader
          title={isEdit ? 'Edit Listing' : 'Add Listing'}
          description={isEdit ? 'Update listing details, market, and status.' : 'Create a new listing and set its details.'}
        />
        <form className='space-y-6' onSubmit={handleSubmit}>
          <div className='grid gap-4 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label htmlFor='edit-base'>
                Asset base <span className='text-destructive'>*</span>
              </Label>
              <Input
                id='edit-base'
                value={formState.base}
                onChange={event => setFormState(prev => ({ ...prev, base: event.target.value }))}
                required
              />
              {!formState.base.trim() && (
                <p className='text-xs text-destructive'>Required</p>
              )}
            </div>
            <IconUploadField
              isEdit={isEdit}
              defaultAvatar={formState.iconUrl || undefined}
              onFileChange={handleAvatarChange}
              uploading={iconUploading}
              error={iconError}
              emptyMessage='Save the listing first to upload an icon.'
              avatarKey={`${listing?.id ?? 'new'}-${open ? 'open' : 'closed'}`}
            />
            <div className='space-y-2'>
              <Label htmlFor='edit-quote'>Quote</Label>
              <SearchableSelect
                value={formState.quote}
                placeholder='Select quote currency'
                options={currencyDropdownOptions}
                searchValue={currencySearch}
                onSearchChange={setCurrencySearch}
                searchPlaceholder='Search currencies...'
                loading={currencyLoading}
                emptyMessage={currencyError ?? 'No currencies found.'}
                selectedLabel={selectedQuoteLabel}
                onChange={value => {
                  if (!value) {
                    setFormState(prev => ({ ...prev, quote: '', quoteName: null }))
                    return
                  }
                  const selected = currencyOptionMap.get(value)
                  setFormState(prev => ({
                    ...prev,
                    quote: value,
                    quoteName: selected?.name ?? null
                  }))
                }}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='edit-asset-class'>Asset class</Label>
              <SearchableSelect
                value={formState.assetClass}
                placeholder='Select asset class'
                options={assetClassOptions}
                searchPlaceholder='Search asset class...'
                emptyMessage='No asset classes found.'
                showClear={false}
                shouldFilter
                open={assetClassOpen}
                onOpenChange={setAssetClassOpen}
                buttonProps={{
                  id: 'edit-asset-class',
                  role: 'combobox',
                  'aria-expanded': assetClassOpen
                }}
                onChange={value => setFormState(prev => ({ ...prev, assetClass: value }))}
              />
            </div>
            <div className='space-y-2 md:col-span-2'>
              <Label htmlFor='edit-name'>Listing name</Label>
              <Input
                id='edit-name'
                value={formState.name}
                onChange={event => setFormState(prev => ({ ...prev, name: event.target.value }))}
                placeholder='Optional display label'
              />
            </div>
          </div>

          <div className='grid gap-4 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label>Market</Label>
              <SearchableSelect
                value={formState.marketId}
                placeholder='Select market'
                options={marketDropdownOptions}
                searchValue={marketSearch}
                onSearchChange={setMarketSearch}
                searchPlaceholder='Search markets...'
                loading={marketLoading}
                emptyMessage={marketError ?? 'No markets found.'}
                selectedLabel={selectedMarketLabel}
                onChange={value => {
                  if (!value) {
                    setFormState(prev => ({ ...prev, marketId: '', marketLabel: '' }))
                    return
                  }
                  const selected = marketOptionMap.get(value)
                  const label = selected ? (selected.name ? `${selected.code} — ${selected.name}` : selected.code) : ''
                  setFormState(prev => ({
                    ...prev,
                    marketId: value,
                    marketLabel: label || prev.marketLabel
                  }))
                }}
              />
            </div>
            <div className='space-y-2'>
              <Label>Listing status</Label>
              <div className='flex items-center justify-between rounded-md border px-3 py-2'>
                <div className='space-y-0.5'>
                  <p className='text-sm font-medium leading-none'>Active</p>
                  <p className='text-xs text-muted-foreground'>Toggle to enable or disable the listing.</p>
                </div>
                <Switch
                  checked={formState.active}
                  onCheckedChange={checked => setFormState(prev => ({ ...prev, active: checked }))}
                />
              </div>
            </div>
          </div>

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
