'use client'

import { useEffect, useMemo, useState, type FormEvent } from 'react'

import { EditDialogFooter, EditDialogHeader, FormError, SearchableSelect } from '@/components/edit-dialog'
import {
  Dialog,
  DialogContent
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CityRow, CountryOption, TimeZoneOption } from './types'

type CityEditDialogProps = {
  city: CityRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (city: CityRow) => void
  mode?: 'edit' | 'create'
}

type CityFormState = {
  name: string
  countryId: string
  timeZoneId: string
  timeZoneLabel: string
}

export function CityEditDialog({ city, open, onOpenChange, onSave, mode = 'edit' }: CityEditDialogProps) {
  const isEdit = mode === 'edit' && !!city

  const [formState, setFormState] = useState<CityFormState>({
    name: '',
    countryId: '',
    timeZoneId: '',
    timeZoneLabel: ''
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [countrySearch, setCountrySearch] = useState('')
  const [countryOptions, setCountryOptions] = useState<CountryOption[]>([])
  const [countryLoading, setCountryLoading] = useState(false)
  const [countryError, setCountryError] = useState<string | null>(null)
  const [tzSearch, setTzSearch] = useState('')
  const [tzOptions, setTzOptions] = useState<TimeZoneOption[]>([])
  const [tzLoading, setTzLoading] = useState(false)
  const [tzError, setTzError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    if (city) {
      setFormState({
        name: city.name,
        countryId: city.countryId ?? '',
        timeZoneId: city.timeZoneId ?? '',
        timeZoneLabel: city.timeZoneName ?? ''
      })
    } else {
      setFormState({ name: '', countryId: '', timeZoneId: '', timeZoneLabel: '' })
    }
    setError(null)
    setCountrySearch('')
    setTzSearch('')
  }, [city, open])

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      setCountryLoading(true)
      setCountryError(null)
      const params = new URLSearchParams({ limit: '1000' })
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
          if (formState.timeZoneId && !options.some(o => o.id === formState.timeZoneId)) {
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
    formState.name.trim().length > 0 &&
    formState.countryId.trim().length > 0 &&
    formState.timeZoneId.trim().length > 0 &&
    !saving

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!formState.name.trim() || !formState.countryId.trim() || !formState.timeZoneId.trim()) {
      setError('City name, country, and time zone are required.')
      return
    }

    try {
      setSaving(true)
      setError(null)
      const payload = {
        name: formState.name.trim(),
        countryId: formState.countryId,
        timeZoneId: formState.timeZoneId || null
      }

      const response = isEdit
        ? await fetch(`/api/cities/${city!.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          })
        : await fetch(`/api/cities`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          })

      if (!response.ok) {
        const message = await response
          .json()
          .then(body => body?.error ?? 'Failed to save city.')
          .catch(() => 'Failed to save city.')
        throw new Error(message)
      }

      const result = (await response.json()) as { data: CityRow | null }
      if (!result.data) {
        throw new Error('City could not be loaded after save.')
      }

      onSave(result.data)
      onOpenChange(false)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to save city.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={nextOpen => onOpenChange(nextOpen)}>
      <DialogContent className='max-w-2xl'>
        <EditDialogHeader
          title={isEdit ? 'Edit City' : 'Add City'}
          description={isEdit ? 'Update city details and time zone.' : 'Create a new city.'}
        />
        <form className='space-y-6' onSubmit={handleSubmit}>
          <div className='space-y-2'>
            <Label htmlFor='city-name'>City name <span className='text-destructive'>*</span></Label>
            <Input
              id='city-name'
              value={formState.name}
              onChange={event => setFormState(prev => ({ ...prev, name: event.target.value }))}
              required
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
                    timeZoneId: value ? prev.timeZoneId : ''
                  }))
                }}
              />
              {!formState.countryId.trim() && <p className='text-xs text-destructive'>Required</p>}
            </div>

            <div className='space-y-2'>
              <Label>Time zone <span className='text-destructive'>*</span></Label>
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
              {!formState.timeZoneId.trim() && <p className='text-xs text-destructive'>Required</p>}
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
