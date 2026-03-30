'use client'

import { useEffect, useMemo, useState, type FormEvent } from 'react'

import { EditDialogFooter, EditDialogHeader, FormError, SearchableSelect } from '@/components/edit-dialog'
import {
  Dialog,
  DialogContent
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ExchangeRow, ExchangeOption, CountryOption } from './types'

type ExchangeEditDialogProps = {
  exchange: ExchangeRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (exchange: ExchangeRow) => void
  mode?: 'edit' | 'create'
}

type ExchangeFormState = {
  mic: string
  name: string
  lei: string
  url: string
  createdAt: string
  expiredAt: string
  countryId: string
  cityId: string
  active: boolean
  isSegment: boolean
  parentId: string
}

export function ExchangeEditDialog({ exchange, open, onOpenChange, onSave, mode = 'edit' }: ExchangeEditDialogProps) {
  const isEdit = mode === 'edit' && !!exchange

  const [formState, setFormState] = useState<ExchangeFormState>({
    mic: '',
    name: '',
    lei: '',
    url: '',
    createdAt: '',
    expiredAt: '',
    countryId: '',
    cityId: '',
    active: true,
    isSegment: false,
    parentId: ''
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [countrySearch, setCountrySearch] = useState('')
  const [countryOptions, setCountryOptions] = useState<CountryOption[]>([])
  const [countryLoading, setCountryLoading] = useState(false)
  const [countryError, setCountryError] = useState<string | null>(null)
  const [citySearch, setCitySearch] = useState('')
  const [cityOptions, setCityOptions] = useState<{ value: string; label: string }[]>([])
  const [cityLoading, setCityLoading] = useState(false)
  const [cityError, setCityError] = useState<string | null>(null)
  const [parentSearch, setParentSearch] = useState('')
  const [parentOptions, setParentOptions] = useState<ExchangeOption[]>([])
  const [parentLoading, setParentLoading] = useState(false)
  const [parentError, setParentError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return

    if (exchange) {
      setFormState({
        mic: exchange.mic,
        name: exchange.name ?? '',
        lei: exchange.lei ?? '',
        url: exchange.url ?? '',
        createdAt: exchange.createdAt ? exchange.createdAt.slice(0, 10) : '',
        expiredAt: exchange.expiredAt ? exchange.expiredAt.slice(0, 10) : '',
        countryId: exchange.countryId ?? '',
        cityId: exchange.cityId ?? '',
        active: exchange.active,
        isSegment: exchange.isSegment ?? false,
        parentId: exchange.parentId ?? ''
      })
    } else {
      setFormState({
        mic: '',
        name: '',
        lei: '',
        url: '',
        createdAt: '',
        expiredAt: '',
        countryId: '',
        cityId: '',
        active: true,
        isSegment: false,
        parentId: ''
      })
    }

    setError(null)
    setCountrySearch('')
    setCitySearch('')
    setParentSearch('')
    setParentError(null)
  }, [exchange, open])

  useEffect(() => {
    if (!open || !exchange?.cityId || !exchange.cityName) return
    const cityId = exchange.cityId
    const cityName = exchange.cityName
    setCityOptions(prev => {
      if (prev.some(option => option.value === cityId)) return prev
      return [...prev, { value: cityId, label: cityName }]
    })
  }, [open, exchange?.cityId, exchange?.cityName])

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      setCountryLoading(true)
      setCountryError(null)
      const params = new URLSearchParams({ limit: '200' })
      const trimmed = countrySearch.trim()
      if (trimmed) params.set('query', trimmed)

      fetch(`/api/countries?${params.toString()}`, { signal: controller.signal })
        .then(async response => {
          if (!response.ok) throw new Error(`Request failed with ${response.status}`)
          const payload = (await response.json()) as { data: CountryOption[] }
          setCountryOptions(payload.data)
        })
        .catch(fetchError => {
          if (fetchError instanceof DOMException && fetchError.name === 'AbortError') return
          setCountryError('Unable to load countries.')
          setCountryOptions([])
        })
        .finally(() => setCountryLoading(false))
    }, 200)

    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [countrySearch, open])

  useEffect(() => {
    if (!open) return
    if (!formState.countryId) {
      if (!formState.cityId) {
        setCityOptions([])
      }
      return
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => {
      setCityLoading(true)
      setCityError(null)

      const params = new URLSearchParams({ limit: '200' })
      const trimmed = citySearch.trim()
      if (trimmed) params.set('query', trimmed)
      params.set('countryId', formState.countryId)

      fetch(`/api/cities?${params.toString()}`, { signal: controller.signal })
        .then(async response => {
          if (!response.ok) throw new Error(`Request failed with ${response.status}`)
          const payload = (await response.json()) as { data: { id: string; name: string }[] }
          setCityOptions(payload.data.map(c => ({ value: c.id, label: c.name })))
        })
        .catch(fetchError => {
          if (fetchError instanceof DOMException && fetchError.name === 'AbortError') return
          setCityError('Unable to load cities.')
          setCityOptions([])
        })
        .finally(() => setCityLoading(false))
    }, 200)

    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [citySearch, formState.countryId, formState.cityId, open])

  useEffect(() => {
    if (!open || !formState.cityId) return
    const exists = cityOptions.some(option => option.value === formState.cityId)
    if (exists) return

    const controller = new AbortController()
    fetch(`/api/cities?page=1&pageSize=25&id=${encodeURIComponent(formState.cityId)}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(`Request failed with ${response.status}`)
        const payload = (await response.json()) as { data: { id: string; name: string; countryId: string }[] }
        const selected = payload.data?.find(option => option.id === formState.cityId) ?? payload.data?.[0]
        if (!selected) return
        setCityOptions(prev => {
          const merged = [...prev, { value: selected.id, label: selected.name }]
          const seen = new Set<string>()
          return merged.filter(option => {
            if (seen.has(option.value)) return false
            seen.add(option.value)
            return true
          })
        })
        if (!formState.countryId && selected.countryId) {
          setFormState(prev => ({ ...prev, countryId: selected.countryId }))
        }
      })
      .catch(() => {})
    return () => controller.abort()
  }, [open, formState.cityId, formState.countryId, cityOptions])

  useEffect(() => {
    if (!open || !formState.isSegment) {
      setParentOptions([])
      return
    }
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      setParentLoading(true)
      setParentError(null)
      const params = new URLSearchParams({ limit: '200' })
      const trimmed = parentSearch.trim()
      if (trimmed) params.set('query', trimmed)

      fetch(`/api/exchanges?${params.toString()}`, { signal: controller.signal })
        .then(async response => {
          if (!response.ok) throw new Error(`Request failed with ${response.status}`)
          const payload = (await response.json()) as { data: ExchangeOption[] }
          setParentOptions(payload.data)
        })
        .catch(fetchError => {
          if (fetchError instanceof DOMException && fetchError.name === 'AbortError') return
          setParentError('Unable to load exchanges.')
          setParentOptions([])
        })
        .finally(() => setParentLoading(false))
    }, 200)

    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [parentSearch, open, formState.isSegment])

  useEffect(() => {
    if (!open || !formState.isSegment || !formState.parentId) return
    const exists = parentOptions.some(option => option.id === formState.parentId)
    if (exists) return
    const controller = new AbortController()
    fetch(`/api/exchanges?page=1&pageSize=1&id=${encodeURIComponent(formState.parentId)}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(`Request failed with ${response.status}`)
        const payload = (await response.json()) as { data: ExchangeRow[] }
        const selected = payload.data?.[0]
        if (!selected) return
        setParentOptions(prev => {
          const merged = [...prev, { id: selected.id, mic: selected.mic, name: selected.name ?? null }]
          const seen = new Set<string>()
          return merged.filter(option => {
            if (seen.has(option.id)) return false
            seen.add(option.id)
            return true
          })
        })
      })
      .catch(() => {})
    return () => controller.abort()
  }, [open, formState.isSegment, formState.parentId, parentOptions])

  const countryDropdownOptions = useMemo(
    () => countryOptions.map(option => ({ value: option.id, label: `${option.code} — ${option.name}` })),
    [countryOptions]
  )

  const cityDropdownOptions = cityOptions.map(option => ({ value: option.value, label: option.label }))
  const parentDropdownOptions = useMemo(() => {
    const options = (isEdit && exchange ? parentOptions.filter(option => option.id !== exchange.id) : parentOptions)
      .map(option => ({
        value: option.id,
        label: option.mic ? `${option.mic}${option.name ? ` — ${option.name}` : ''}` : option.id
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
    return options
  }, [parentOptions, isEdit, exchange])

  const selectedCityLabel =
    formState.cityId &&
    (cityDropdownOptions.find(option => option.value === formState.cityId)?.label ??
      (exchange && exchange.cityId === formState.cityId ? exchange.cityName ?? undefined : undefined))
  const selectedParentLabel =
    formState.parentId && parentDropdownOptions.find(option => option.value === formState.parentId)?.label

  const isFormValid = formState.mic.trim().length > 0 && !saving

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!formState.mic.trim()) {
      setError('MIC code is required.')
      return
    }

    try {
      setSaving(true)
      setError(null)
      const normalizeDate = (value: string) => {
        const trimmed = value.trim()
        if (!trimmed) return null
        const parsed = new Date(trimmed)
        if (Number.isNaN(parsed.getTime())) return null
        return parsed.toISOString()
      }

      const payload = {
        mic: formState.mic.trim(),
        name: formState.name.trim() || null,
        lei: formState.lei.trim() || null,
        url: formState.url.trim() || null,
        createdAt: normalizeDate(formState.createdAt),
        expiredAt: normalizeDate(formState.expiredAt),
        countryId: formState.countryId || null,
        cityId: formState.cityId || null,
        active: formState.active,
        isSegment: formState.isSegment,
        parentId: formState.isSegment ? formState.parentId || null : null
      }

      const response = isEdit
        ? await fetch(`/api/exchanges/${exchange!.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          })
        : await fetch(`/api/exchanges`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          })

      if (!response.ok) {
        const message = await response
          .json()
          .then(body => body?.error ?? 'Failed to save exchange.')
          .catch(() => 'Failed to save exchange.')
        throw new Error(message)
      }

      const result = (await response.json()) as { data: ExchangeRow | null }
      if (!result.data) {
        throw new Error('Exchange could not be loaded after save.')
      }

      onSave(result.data)
      onOpenChange(false)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to save exchange.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={nextOpen => onOpenChange(nextOpen)}>
      <DialogContent className='max-w-2xl'>
        <EditDialogHeader
          title={isEdit ? 'Edit exchange' : 'Add exchange'}
          description={isEdit ? 'Update exchange details and status.' : 'Create a new exchange.'}
        />
        <form className='space-y-6' onSubmit={handleSubmit}>
          <div className='grid gap-4 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label htmlFor='edit-mic-code'>MIC code <span className='text-destructive'>*</span></Label>
              <Input
                id='edit-mic-code'
                value={formState.mic}
                onChange={event => setFormState(prev => ({ ...prev, mic: event.target.value }))}
                required
              />
              {!formState.mic.trim() && <p className='text-xs text-destructive'>Required</p>}
            </div>
            <div className='space-y-2'>
              <Label htmlFor='edit-exchange-name'>Name</Label>
              <Input
                id='edit-exchange-name'
                value={formState.name}
                onChange={event => setFormState(prev => ({ ...prev, name: event.target.value }))}
                placeholder='Optional display name'
              />
            </div>
          </div>
          <div className='grid gap-4 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label htmlFor='edit-exchange-lei'>LEI</Label>
              <Input
                id='edit-exchange-lei'
                value={formState.lei}
                onChange={event => setFormState(prev => ({ ...prev, lei: event.target.value }))}
                placeholder='Optional legal entity identifier'
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='edit-exchange-url'>Website</Label>
              <Input
                id='edit-exchange-url'
                value={formState.url}
                onChange={event => setFormState(prev => ({ ...prev, url: event.target.value }))}
                placeholder='https://'
              />
            </div>
          </div>

          <div className='grid gap-4 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label htmlFor='edit-exchange-created'>Created</Label>
              <Input
                id='edit-exchange-created'
                type='date'
                value={formState.createdAt}
                onChange={event => setFormState(prev => ({ ...prev, createdAt: event.target.value }))}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='edit-exchange-expired'>Expired</Label>
              <Input
                id='edit-exchange-expired'
                type='date'
                value={formState.expiredAt}
                onChange={event => setFormState(prev => ({ ...prev, expiredAt: event.target.value }))}
              />
            </div>
          </div>

          <div className='grid gap-4 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label>Country</Label>
              <SearchableSelect
                value={formState.countryId}
                placeholder='Select country'
                options={countryDropdownOptions}
                searchValue={countrySearch}
                onSearchChange={setCountrySearch}
                searchPlaceholder='Search countries...'
                loading={countryLoading}
                emptyMessage={countryError ?? 'No countries found.'}
                onChange={value => {
                  setFormState(prev => ({ ...prev, countryId: value, cityId: '' }))
                }}
              />
            </div>
            <div className='space-y-2'>
              <Label>City</Label>
              <SearchableSelect
                value={formState.cityId}
                placeholder='Select city'
                options={cityDropdownOptions}
                searchValue={citySearch}
                onSearchChange={setCitySearch}
                searchPlaceholder='Search cities...'
                loading={cityLoading}
                emptyMessage={cityError ?? 'No cities found.'}
                selectedLabel={selectedCityLabel}
                disabled={!formState.countryId && !formState.cityId}
                onChange={value => {
                  setFormState(prev => ({ ...prev, cityId: value }))
                }}
              />
            </div>
          </div>

          <div className='grid gap-4 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label>Segment</Label>
              <div className='flex items-center justify-between rounded-md border px-3 py-2'>
                <div className='space-y-0.5'>
                  <p className='text-sm font-medium leading-none'>Is segment</p>
                  <p className='text-xs text-muted-foreground'>Mark this exchange as a segment of a parent venue.</p>
                </div>
                <Switch
                  checked={formState.isSegment}
                  onCheckedChange={checked => {
                    setFormState(prev => ({
                      ...prev,
                      isSegment: checked,
                      parentId: checked ? prev.parentId : ''
                    }))
                    if (!checked) setParentSearch('')
                  }}
                />
              </div>
            </div>
            <div className='space-y-2'>
              <Label>Parent exchange</Label>
              <SearchableSelect
                value={formState.parentId}
                placeholder='Select parent exchange'
                options={parentDropdownOptions}
                searchValue={parentSearch}
                onSearchChange={setParentSearch}
                searchPlaceholder='Search exchanges...'
                loading={parentLoading}
                emptyMessage={parentError ?? 'No exchanges found.'}
                selectedLabel={selectedParentLabel}
                disabled={!formState.isSegment}
                onChange={value => {
                  setFormState(prev => ({ ...prev, parentId: value }))
                }}
              />
              {!formState.isSegment && (
                <p className='text-xs text-muted-foreground'>Enable segment to select a parent exchange.</p>
              )}
            </div>
          </div>

          <div className='space-y-2'>
            <Label>Exchange status</Label>
            <div className='flex items-center justify-between rounded-md border px-3 py-2'>
              <div className='space-y-0.5'>
                <p className='text-sm font-medium leading-none'>Active</p>
                <p className='text-xs text-muted-foreground'>Toggle to enable or disable the exchange.</p>
              </div>
              <Switch
                checked={formState.active}
                onCheckedChange={checked => setFormState(prev => ({ ...prev, active: checked }))}
              />
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
