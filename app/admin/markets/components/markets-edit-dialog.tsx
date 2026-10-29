'use client'

import { useEffect, useMemo, useState, type FormEvent } from 'react'

import { EditDialogFooter, EditDialogHeader, FormError, SearchableSelect } from '@/components/edit-dialog'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CityOption, CountryOption, MarketRow, TimeZoneOption } from './types'

type MarketEditDialogProps = {
  market: MarketRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (market: MarketRow) => void
  mode?: 'edit' | 'create'
}

type MarketFormState = {
  code: string
  name: string
  url: string
  countryId: string
  cityId: string
  timeZoneId: string
  timeZoneLabel: string
}

const createMarketFormState = (market: MarketRow | null): MarketFormState => ({
  code: market?.code ?? '',
  name: market?.name ?? '',
  url: market?.url ?? '',
  countryId: market?.countryId ?? '',
  cityId: market?.cityId ?? '',
  timeZoneId: market?.timeZoneId ?? '',
  timeZoneLabel: market?.timeZoneName ?? ''
})

const createInitialCityOptions = (market: MarketRow | null) =>
  market?.cityId && market.cityName ? [{ value: market.cityId, label: market.cityName }] : []

export function MarketEditDialog(props: MarketEditDialogProps) {
  const { market, open, onOpenChange, mode = 'edit' } = props
  const sessionKey = `${mode}:${market?.id ?? 'new'}`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className='max-w-3xl'>
        <MarketEditDialogContent key={`${sessionKey}:${open ? 'open' : 'closed'}`} {...props} />
      </DialogContent>
    </Dialog>
  )
}

function MarketEditDialogContent({ market, open, onOpenChange, onSave, mode = 'edit' }: MarketEditDialogProps) {
  const isEdit = mode === 'edit' && !!market

  const [formState, setFormState] = useState<MarketFormState>(() => createMarketFormState(market))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [countrySearch, setCountrySearch] = useState('')
  const [countryOptions, setCountryOptions] = useState<CountryOption[]>([])
  const [countryLoading, setCountryLoading] = useState(false)
  const [countryError, setCountryError] = useState<string | null>(null)
  const [citySearch, setCitySearch] = useState('')
  const [cityOptions, setCityOptions] = useState<{ value: string; label: string }[]>(() =>
    createInitialCityOptions(market)
  )
  const [cityLoading, setCityLoading] = useState(false)
  const [cityError, setCityError] = useState<string | null>(null)
  const [tzSearch, setTzSearch] = useState('')
  const [tzOptions, setTzOptions] = useState<TimeZoneOption[]>([])
  const [tzLoading, setTzLoading] = useState(false)
  const [tzError, setTzError] = useState<string | null>(null)

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
    if (!open || !formState.countryId) return

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
          const payload = (await response.json()) as { data: CityOption[] }
          setCityOptions(payload.data.map(city => ({ value: city.id, label: city.name })))
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
  }, [citySearch, formState.countryId, open])

  useEffect(() => {
    if (!open || !formState.cityId) return
    const exists = cityOptions.some(option => option.value === formState.cityId)
    if (exists) return

    const controller = new AbortController()
    fetch(`/api/cities?page=1&pageSize=25&id=${encodeURIComponent(formState.cityId)}`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error(`Request failed with ${response.status}`)
        const payload = (await response.json()) as { data: CityOption[] }
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
          setFormState(prev => ({ ...prev, countryId: selected.countryId ?? '' }))
        }
      })
      .catch(() => {})
    return () => controller.abort()
  }, [formState.cityId, formState.countryId, cityOptions, open])

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      setTzLoading(true)
      setTzError(null)
      const params = new URLSearchParams({ limit: '1000' })
      const trimmed = tzSearch.trim()
      if (trimmed) {
        params.set('query', trimmed)
      }

      fetch(`/api/time-zones?${params.toString()}`, { signal: controller.signal })
        .then(async response => {
          if (!response.ok) throw new Error(`Request failed with ${response.status}`)
          const payload = (await response.json()) as { data: TimeZoneOption[] }

          let options = payload.data
          if (formState.timeZoneId && !options.some(option => option.id === formState.timeZoneId)) {
            options = [
              {
                id: formState.timeZoneId,
                name: formState.timeZoneLabel || formState.timeZoneId,
                offset: '',
                offsetDst: null
              },
              ...options
            ]
          }

          setTzOptions(options)
        })
        .catch(fetchError => {
          if (fetchError instanceof DOMException && fetchError.name === 'AbortError') return
          setTzError('Unable to load time zones.')
          setTzOptions([])
        })
        .finally(() => setTzLoading(false))
    }, 200)

    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [tzSearch, formState.timeZoneId, formState.timeZoneLabel, open])

  const countryDropdownOptions = useMemo(
    () => countryOptions.map(option => ({ value: option.id, label: `${option.code} — ${option.name}` })),
    [countryOptions]
  )

  const tzDropdownOptions = useMemo(
    () =>
      tzOptions.map(option => {
        const offsetLabel = option.offset
          ? ` (${option.offset}${option.offsetDst ? ` / ${option.offsetDst}` : ''})`
          : ''
        return {
          value: option.id,
          label: `${option.name || option.id}${offsetLabel}`
        }
      }),
    [tzOptions]
  )

  const selectedTzLabel =
    formState.timeZoneId &&
    (tzDropdownOptions.find(option => option.value === formState.timeZoneId)?.label ??
      formState.timeZoneLabel ??
      formState.timeZoneId)

  const isFormValid =
    formState.code.trim().length > 0 &&
    formState.name.trim().length > 0 &&
    formState.countryId.trim().length > 0 &&
    !saving

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!formState.code.trim() || !formState.name.trim() || !formState.countryId.trim()) {
      setError('Market code, name, and country are required.')
      return
    }

    try {
      setSaving(true)
      setError(null)
      const payload = {
        code: formState.code.trim(),
        name: formState.name.trim(),
        url: formState.url.trim() || null,
        countryId: formState.countryId.trim(),
        cityId: formState.cityId.trim() ? formState.cityId : null,
        timeZoneId: formState.timeZoneId.trim() ? formState.timeZoneId : null
      }

      const response = isEdit
        ? await fetch(`/api/markets/${market!.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          })
        : await fetch(`/api/markets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          })

      if (!response.ok) {
        const message = await response
          .json()
          .then(body => body?.error ?? 'Failed to save market.')
          .catch(() => 'Failed to save market.')
        throw new Error(message)
      }

      const result = (await response.json()) as { data: MarketRow | null }
      if (!result.data) {
        throw new Error('Market could not be loaded after save.')
      }

      onSave(result.data)
      onOpenChange(false)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to save market.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
        <EditDialogHeader
          title={isEdit ? 'Edit Market' : 'Add Market'}
          description={isEdit ? 'Update market details and location.' : 'Create a new market.'}
        />
        <form className='space-y-6' onSubmit={handleSubmit}>
          <div className='grid gap-4 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label htmlFor='market-code'>Code <span className='text-destructive'>*</span></Label>
              <Input
                id='market-code'
                value={formState.code}
                onChange={event => setFormState(prev => ({ ...prev, code: event.target.value }))}
                required
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='market-name'>Name <span className='text-destructive'>*</span></Label>
              <Input
                id='market-name'
                value={formState.name}
                onChange={event => setFormState(prev => ({ ...prev, name: event.target.value }))}
                required
              />
            </div>
          </div>

          <div className='space-y-2'>
            <Label htmlFor='market-url'>URL</Label>
            <Input
              id='market-url'
              value={formState.url}
              onChange={event => setFormState(prev => ({ ...prev, url: event.target.value }))}
              placeholder='https://example.com'
            />
          </div>

          <div className='grid gap-4 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label>Country <span className='text-destructive'>*</span></Label>
              <SearchableSelect
                value={formState.countryId}
                placeholder='Select country'
                options={countryDropdownOptions}
                searchValue={countrySearch}
                onSearchChange={setCountrySearch}
                searchPlaceholder='Search countries...'
                loading={countryLoading}
                emptyMessage={countryError ?? 'No countries found.'}
                clearLabelClassName='truncate text-destructive'
                onChange={value => {
                  setFormState(prev => ({
                    ...prev,
                    countryId: value,
                    cityId: value === prev.countryId ? prev.cityId : ''
                  }))
                  setCitySearch('')
                  setCityOptions([])
                  setCityError(null)
                }}
              />
              <FormError message={!formState.countryId.trim() ? 'Country is required.' : null} />
            </div>

            <div className='space-y-2'>
              <Label>City</Label>
              <SearchableSelect
                value={formState.cityId}
                placeholder='Select city'
                options={cityOptions}
                searchValue={citySearch}
                onSearchChange={setCitySearch}
                searchPlaceholder='Search cities...'
                loading={cityLoading}
                emptyMessage={cityError ?? 'No cities found.'}
                onChange={value => setFormState(prev => ({ ...prev, cityId: value }))}
                disabled={!formState.countryId}
              />
            </div>
          </div>

          <div className='space-y-2'>
            <Label>Time zone</Label>
            <SearchableSelect
              value={formState.timeZoneId}
              placeholder='Select time zone'
              options={tzDropdownOptions}
              searchValue={tzSearch}
              onSearchChange={setTzSearch}
              searchPlaceholder='Search time zones...'
              loading={tzLoading}
              emptyMessage={tzError ?? 'No time zones found.'}
              selectedLabel={selectedTzLabel}
              onChange={value => {
                const matched = tzDropdownOptions.find(option => option.value === value)
                setFormState(prev => ({
                  ...prev,
                  timeZoneId: value,
                  timeZoneLabel: value ? matched?.label ?? prev.timeZoneLabel : ''
                }))
              }}
            />
          </div>

          <FormError message={error} />

          <EditDialogFooter
            onCancel={() => onOpenChange(false)}
            submitDisabled={!isFormValid}
            cancelDisabled={saving}
            loading={saving}
          />
        </form>
    </>
  )
}
