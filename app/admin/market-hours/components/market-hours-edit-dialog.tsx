'use client'

import { useEffect, useMemo, useState } from 'react'

import { CheckIcon, ChevronsUpDownIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { DateLocalizer, momentLocalizer } from 'react-big-calendar'
import moment from 'moment'

import { EditDialogFooter, EditDialogHeader, FormError, SearchableSelect } from '@/components/edit-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Calendar } from '@/components/ui/calendar'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandGroup, CommandItem, CommandList } from '@/components/ui/command'
import ShadcnBigCalendar from '@/components/shadcn-big-calendar/shadcn-big-calendar'
import { MarketHourRow } from './types'

type Option = { id: string; label: string }
type ListingOption = { id: string; base: string; name: string | null }

type MarketHoursEditDialogProps = {
  row: MarketHourRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave?: (updated: MarketHourRow) => void
  mode?: 'edit' | 'create'
}

type SessionEvent = {
  id: string
  title: string
  start: Date
  end: Date
  state: string
}

// States observed in market_hours.json and market-hours-database.json
const sessionStateOptions = ['premarket', 'market', 'postmarket']

type Holiday = { id: string; date: string }
type EarlyClose = { id: string; date: string; time: string }

const assetClassOptions: Option[] = [
  { id: 'stock', label: 'stock' },
  { id: 'etf', label: 'etf' },
  { id: 'indice', label: 'indice' },
  { id: 'mutualfund', label: 'mutual funds' },
  { id: 'future', label: 'future' },
  { id: 'crypto', label: 'crypto' },
  { id: 'currency', label: 'currency' }
]

const localizer: DateLocalizer = momentLocalizer(moment)
const templateWeekStart = moment().startOf('week') // Sunday-aligned with react-big-calendar

const calendarFormats = {
  dayFormat: 'dddd',
  weekdayFormat: 'dddd',
  dayHeaderFormat: 'dddd',
  dayRangeHeaderFormat: (
    { start, end }: { start: Date; end: Date },
    culture: string | undefined,
    loc?: DateLocalizer
  ) => {
    const formatter = loc ?? localizer
    return `${formatter.format(start, 'MMM d', culture)} – ${formatter.format(end, 'MMM d', culture)}`
  }
}

function pad2(n: number) {
  return n.toString().padStart(2, '0')
}

function parseTimeString(value: string, base: Date) {
  const [h, m] = value.split(':').map(Number)
  if (Number.isFinite(h) && Number.isFinite(m)) {
    const d = new Date(base)
    d.setHours(h ?? 0, m ?? 0, 0, 0)
    return d
  }
  return base
}

function timeToDate(dayIndex: number, time: string) {
  const [h, m, s] = time.split(':').map(Number)
  const d = templateWeekStart.clone().add(dayIndex, 'day').hour(h || 0).minute(m || 0).second(s || 0)
  return d.toDate()
}

function dayIndexFromKey(key: string) {
  const map: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 }
  return map[key] ?? 0
}

const dayKeys = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

function dayKeyFromIndex(index: number) {
  return dayKeys[index] ?? 'sunday'
}

function toDateMaybe(date?: string) {
  if (!date) return undefined
  const m = moment(date, 'YYYY-MM-DD', true)
  return m.isValid() ? m.toDate() : new Date(date)
}

function formatDateLabel(date?: string) {
  if (!date) return 'Pick date'
  return moment(date).format('MMM D, YYYY')
}

function formatTime(value: Date) {
  return `${pad2(value.getHours())}:${pad2(value.getMinutes())}:${pad2(value.getSeconds())}`
}

export function MarketHoursEditDialog({
  row,
  open,
  onOpenChange,
  onSave,
  mode = 'edit'
}: MarketHoursEditDialogProps) {
  const isEdit = mode === 'edit' && !!row
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [countryOptions, setCountryOptions] = useState<Option[]>([])
  const [countrySearch, setCountrySearch] = useState('')
  const [countryLoading, setCountryLoading] = useState(false)

  const [cityOptions, setCityOptions] = useState<Option[]>([])
  const [citySearch, setCitySearch] = useState('')
  const [cityLoading, setCityLoading] = useState(false)

  const [marketOptions, setMarketOptions] = useState<Option[]>([])
  const [marketSearch, setMarketSearch] = useState('')
  const [marketLoading, setMarketLoading] = useState(false)

  const [tzOptions, setTzOptions] = useState<Option[]>([])
  const [tzSearch, setTzSearch] = useState('')
  const [tzLoading, setTzLoading] = useState(false)

  const [listingOptions, setListingOptions] = useState<ListingOption[]>([])
  const [listingSearch, setListingSearch] = useState('')
  const [listingLoading, setListingLoading] = useState(false)

  const [formState, setFormState] = useState({
    countryId: '',
    cityId: '',
    assetClass: '',
    marketId: '',
    timeZoneId: '',
    listingId: ''
  })

  const [sessionEvents, setSessionEvents] = useState<SessionEvent[]>([])
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [sessionEditorOpen, setSessionEditorOpen] = useState(false)
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [earlyCloses, setEarlyCloses] = useState<EarlyClose[]>([])
  const [addHolidayOpen, setAddHolidayOpen] = useState(false)
  const [newHolidayDate, setNewHolidayDate] = useState<Date | undefined>(undefined)
  const [addEarlyCloseOpen, setAddEarlyCloseOpen] = useState(false)
  const [newEarlyCloseDate, setNewEarlyCloseDate] = useState<Date | undefined>(undefined)
  const [newEarlyCloseTime, setNewEarlyCloseTime] = useState('')

  useEffect(() => {
    if (!open) return

    setError(null)
    setCountrySearch('')
    setCitySearch('')
    setMarketSearch('')
    setTzSearch('')
    setListingSearch('')
    setEditingSessionId(null)
    setSessionEditorOpen(false)
    setNewHolidayDate(undefined)
    setAddHolidayOpen(false)
    setNewEarlyCloseDate(undefined)
    setNewEarlyCloseTime('')
    setAddEarlyCloseOpen(false)

    if (row) {
      setFormState({
        countryId: row.countryId ?? '',
        cityId: row.cityId ?? '',
        assetClass: row.assetClass ?? '',
        marketId: row.marketId ?? '',
        timeZoneId: row.timeZoneId ?? '',
        listingId: row.listingId ?? ''
      })

      const hours = (row.hours as any) || {}
      const sessions = (hours.sessions ?? {}) as Record<string, { start: string; end: string; state?: string }[]>
      const events: SessionEvent[] = []
      Object.entries(sessions).forEach(([day, entries]) => {
        const dayIdx = dayIndexFromKey(day)
          ; (entries ?? []).forEach((entry, idx) => {
            if (!entry?.start || !entry?.end) return
            events.push({
              id: `${day}-${idx}`,
              title: entry.state ?? 'session',
              start: timeToDate(dayIdx, entry.start),
              end: timeToDate(dayIdx, entry.end),
              state: entry.state ?? 'session'
            })
          })
      })
      setSessionEvents(events)

      const holidaysArr: string[] = Array.isArray(hours.holidays) ? hours.holidays : []
      setHolidays(holidaysArr.map((h, idx) => ({ id: `${idx}`, date: h })))

      const earlyClosesObj: Record<string, string> = hours.earlyCloses ?? {}
      setEarlyCloses(Object.entries(earlyClosesObj).map(([date, time], idx) => ({ id: `${idx}`, date, time })))
    } else {
      setFormState({
        countryId: '',
        cityId: '',
        assetClass: '',
        marketId: '',
        timeZoneId: '',
        listingId: ''
      })
      setSessionEvents([])
      setHolidays([])
      setEarlyCloses([])
    }
  }, [open, row])

  // options fetchers
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      setCountryLoading(true)
      const params = new URLSearchParams({ limit: '500' })
      const trimmed = countrySearch.trim()
      if (trimmed) params.set('query', trimmed)
      fetch(`/api/countries?${params.toString()}`, { signal: controller.signal })
        .then(res => res.json())
        .then((payload: { data: { id: string; code: string; name: string }[] }) => {
          setCountryOptions(payload.data.map(c => ({ id: c.id, label: `${c.code} — ${c.name}` })))
        })
        .catch(() => setCountryOptions([]))
        .finally(() => setCountryLoading(false))
    }, 200)
    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [countrySearch, open])

  useEffect(() => {
    if (!open || !formState.countryId) {
      setCityOptions([])
      return
    }
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      setCityLoading(true)
      const params = new URLSearchParams({ limit: '500', countryId: formState.countryId })
      const trimmed = citySearch.trim()
      if (trimmed) params.set('query', trimmed)
      fetch(`/api/cities?${params.toString()}`, { signal: controller.signal })
        .then(res => res.json())
        .then((payload: { data: { id: string; name: string }[] }) => {
          setCityOptions(payload.data.map(c => ({ id: c.id, label: c.name })))
        })
        .catch(() => setCityOptions([]))
        .finally(() => setCityLoading(false))
    }, 200)
    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [citySearch, formState.countryId, open])

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      setMarketLoading(true)
      const params = new URLSearchParams({ limit: '200' })
      const trimmed = marketSearch.trim()
      if (trimmed) params.set('query', trimmed)
      fetch(`/api/markets?${params.toString()}`, { signal: controller.signal })
        .then(res => res.json())
        .then((payload: { data: { id: string; code: string; name: string | null }[] }) => {
          setMarketOptions(
            payload.data.map(m => ({
              id: m.id,
              label: m.name ? `${m.code} — ${m.name}` : m.code
            }))
          )
        })
        .catch(() => setMarketOptions([]))
        .finally(() => setMarketLoading(false))
    }, 200)
    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [marketSearch, open])

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      setTzLoading(true)
      const params = new URLSearchParams({ limit: '1000' })
      const trimmed = tzSearch.trim()
      if (trimmed) params.set('query', trimmed)
      fetch(`/api/time-zones?${params.toString()}`, { signal: controller.signal })
        .then(res => res.json())
        .then((payload: { data: { id: string; name: string; offset: string; offsetDst?: string | null }[] }) => {
          setTzOptions(payload.data.map(tz => {
            const offsetLabel = tz.offset
              ? ` (${tz.offset}${tz.offsetDst ? ` / ${tz.offsetDst}` : ''})`
              : ''
            return { id: tz.id, label: `${tz.name || tz.id}${offsetLabel}` }
          }))
        })
        .catch(() => setTzOptions([]))
        .finally(() => setTzLoading(false))
    }, 200)
    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [tzSearch, open])

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      setListingLoading(true)
      const params = new URLSearchParams({ page: '1', pageSize: '200' })
      const trimmed = listingSearch.trim()
      if (trimmed) params.set('id', trimmed)
      fetch(`/api/listings?${params.toString()}`, { signal: controller.signal })
        .then(res => res.json())
        .then((payload: { data: { id: string; base: string; name: string | null }[] }) => {
          setListingOptions(payload.data.map(l => ({ id: l.id, base: l.base, name: l.name ?? null })))
        })
        .catch(() => setListingOptions([]))
        .finally(() => setListingLoading(false))
    }, 200)
    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [listingSearch, open])

  // ensure currently selected listing is in options even if not in first page
  useEffect(() => {
    if (!open || !formState.listingId) return
    const exists = listingOptions.some(o => o.id === formState.listingId)
    if (exists) return
    const controller = new AbortController()
    fetch(`/api/listings?page=1&pageSize=1&id=${encodeURIComponent(formState.listingId)}`, { signal: controller.signal })
      .then(res => res.json())
      .then((payload: { data: { id: string; base: string; name: string | null }[] }) => {
        if (!Array.isArray(payload.data) || !payload.data.length) return
        setListingOptions(prev => {
          const merged = [...prev, ...payload.data.map(l => ({ id: l.id, base: l.base, name: l.name ?? null }))]
          const seen = new Set<string>()
          return merged.filter(opt => {
            if (seen.has(opt.id)) return false
            seen.add(opt.id)
            return true
          })
        })
      })
      .catch(() => { })
    return () => controller.abort()
  }, [open, formState.listingId, listingOptions])

  useEffect(() => {
    if (!open || !formState.marketId) return
    const exists = marketOptions.some(o => o.id === formState.marketId)
    if (exists) return
    const controller = new AbortController()
    fetch(`/api/markets?page=1&pageSize=1&id=${encodeURIComponent(formState.marketId)}`, { signal: controller.signal })
      .then(res => res.json())
      .then((payload: { data: { id: string; code: string; name: string | null }[] }) => {
        if (!Array.isArray(payload.data) || !payload.data.length) return
        setMarketOptions(prev => {
          const merged = [
            ...prev,
            ...payload.data.map(m => ({
              id: m.id,
              label: m.name ? `${m.code} — ${m.name}` : m.code
            }))
          ]
          const seen = new Set<string>()
          return merged.filter(opt => {
            if (seen.has(opt.id)) return false
            seen.add(opt.id)
            return true
          })
        })
      })
      .catch(() => { })
    return () => controller.abort()
  }, [open, formState.marketId, marketOptions])

  const handleAddSession = () => {
    const start = templateWeekStart.clone().hour(9).minute(0).toDate()
    const end = templateWeekStart.clone().hour(16).minute(0).toDate()
    const newEvent: SessionEvent = {
      id: `new-${Date.now()}`,
      title: 'session',
      start,
      end,
      state: 'session'
    }
    setSessionEvents(prev => [...prev, newEvent])
    setEditingSessionId(newEvent.id)
    setSessionEditorOpen(true)
  }

  const handleDeleteSession = (id: string) => {
    setSessionEvents(prev => prev.filter(e => e.id !== id))
    if (editingSessionId === id) setEditingSessionId(null)
    setSessionEditorOpen(false)
  }

  const editingSession = useMemo(
    () => sessionEvents.find(ev => ev.id === editingSessionId) ?? null,
    [sessionEvents, editingSessionId]
  )

  const updateEditingSession = (changes: Partial<SessionEvent>) => {
    if (!editingSession) return
    setSessionEvents(prev =>
      prev.map(ev => (ev.id === editingSession.id ? { ...ev, ...changes } : ev))
    )
  }

  const eventPropGetter = (event: SessionEvent) => {
    const state = event.state ? event.state.toLowerCase() : ''
    const variantByState: Record<string, string> = {
      premarket: 'secondary',
      market: 'primary',
      postmarket: 'secondary'
    }
    const variant = variantByState[state] ?? 'primary'
    return {
      className: variant,
      style: {
        marginTop: 5,
        marginBottom: 5
      }
    }
  }

  const handleSaveNewHoliday = () => {
    if (!newHolidayDate) {
      setAddHolidayOpen(false)
      return
    }
    setHolidays(prev => [
      ...prev,
      { id: `h-${Date.now()}`, date: moment(newHolidayDate).format('YYYY-MM-DD') }
    ])
    setNewHolidayDate(undefined)
    setAddHolidayOpen(false)
  }

  const handleSaveNewEarlyClose = () => {
    if (!newEarlyCloseDate || !newEarlyCloseTime.trim()) {
      setAddEarlyCloseOpen(false)
      return
    }
    setEarlyCloses(prev => [
      ...prev,
      {
        id: `e-${Date.now()}`,
        date: moment(newEarlyCloseDate).format('YYYY-MM-DD'),
        time: newEarlyCloseTime
      }
    ])
    setNewEarlyCloseDate(undefined)
    setNewEarlyCloseTime('')
    setAddEarlyCloseOpen(false)
  }

  const buildHoursPayload = () => {
    const sessionsByDay: Record<string, { start: string; end: string; state?: string }[]> = {
      sunday: [],
      monday: [],
      tuesday: [],
      wednesday: [],
      thursday: [],
      friday: [],
      saturday: []
    }

    sessionEvents.forEach(event => {
      const dayIdx = moment(event.start).diff(templateWeekStart, 'days')
      const dayKey = dayKeyFromIndex(dayIdx)
      sessionsByDay[dayKey].push({
        start: formatTime(event.start),
        end: formatTime(event.end),
        state: event.state
      })
    })

    const holidaysPayload = holidays.map(h => h.date).filter(Boolean)
    const earlyClosesPayload = earlyCloses.reduce<Record<string, string>>((acc, entry) => {
      if (entry.date && entry.time) {
        acc[entry.date] = entry.time
      }
      return acc
    }, {})

    return {
      sessions: sessionsByDay,
      holidays: holidaysPayload,
      earlyCloses: earlyClosesPayload
    }
  }

  const handleSave = () => {
    if (!formState.timeZoneId.trim()) {
      setError('Time zone is required.')
      return
    }

    const now = new Date().toISOString()
    const hoursPayload = buildHoursPayload()

    if (isEdit && row) {
      // This is UI-only placeholder; backend save not implemented.
      onSave?.({
        ...row,
        countryId: formState.countryId || null,
        cityId: formState.cityId || null,
        marketId: formState.marketId || null,
        assetClass: formState.assetClass || null,
        timeZoneId: formState.timeZoneId || row.timeZoneId,
        listingId: formState.listingId || null,
        hours: hoursPayload,
        sessionsCount: sessionEvents.length,
        holidaysCount: holidays.length,
        updatedAt: now
      })
      onOpenChange(false)
      return
    }

    const newRow: MarketHourRow = {
      id: `TG_MH_TEMP_${Date.now().toString(36).toUpperCase()}`,
      countryId: formState.countryId || null,
      countryCode: null,
      countryName: null,
      cityId: formState.cityId || null,
      cityName: null,
      marketId: formState.marketId || null,
      marketCode: null,
      marketName: null,
      assetClass: formState.assetClass || null,
      listingId: formState.listingId || null,
      listingBase: null,
      timeZoneId: formState.timeZoneId.trim(),
      timeZoneName: null,
      timeZoneOffset: null,
      sessionsCount: sessionEvents.length,
      holidaysCount: holidays.length,
      updatedAt: now,
      hours: hoursPayload
    }

    onSave?.(newRow)
    onOpenChange(false)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className='max-w-[90vw] max-h-[90vh] overflow-y-auto'>
          <EditDialogHeader
            title={isEdit ? 'Edit Market Hours' : 'Add Market Hours'}
            description={isEdit ? 'Update trading sessions, holidays, and early closes.' : 'Create a new market hours entry.'}
            showRequired={false}
          />
          <div className='flex flex-col gap-4'>
            <div className='grid gap-4 md:grid-cols-3'>
              <div className='space-y-2'>
                <Label>Country</Label>
                <SearchableSelect
                  value={formState.countryId}
                  placeholder='Select country'
                  options={countryOptions.map(option => ({ value: option.id, label: option.label }))}
                  searchValue={countrySearch}
                  onSearchChange={setCountrySearch}
                  searchPlaceholder='Search country...'
                  loading={countryLoading}
                  onChange={value => setFormState(prev => ({ ...prev, countryId: value, cityId: '' }))}
                />
              </div>
              <div className='space-y-2'>
                <Label>City</Label>
                <SearchableSelect
                  value={formState.cityId}
                  placeholder='Select city'
                  options={cityOptions.map(option => ({ value: option.id, label: option.label }))}
                  searchValue={citySearch}
                  onSearchChange={setCitySearch}
                  searchPlaceholder='Search city...'
                  loading={cityLoading}
                  onChange={value => setFormState(prev => ({ ...prev, cityId: value }))}
                  disabled={!formState.countryId}
                />
              </div>
              <div className='space-y-2'>
                <Label>Asset class</Label>
                <SearchableSelect
                  value={formState.assetClass}
                  placeholder='Select asset class'
                  options={assetClassOptions.map(option => ({ value: option.id, label: option.label }))}
                  searchPlaceholder='Search asset class...'
                  shouldFilter
                  onChange={value => setFormState(prev => ({ ...prev, assetClass: value }))}
                />
              </div>
              <div className='space-y-2'>
                <Label>Market</Label>
                <SearchableSelect
                  value={formState.marketId}
                  placeholder='Select market'
                  options={marketOptions.map(option => ({ value: option.id, label: option.label }))}
                  searchValue={marketSearch}
                  onSearchChange={setMarketSearch}
                  searchPlaceholder='Search market...'
                  loading={marketLoading}
                  onChange={value => setFormState(prev => ({ ...prev, marketId: value }))}
                />
              </div>
              <div className='space-y-2'>
                <Label>Time zone</Label>
                <SearchableSelect
                  value={formState.timeZoneId}
                  placeholder='Select time zone'
                  options={tzOptions.map(option => ({ value: option.id, label: option.label }))}
                  searchValue={tzSearch}
                  onSearchChange={setTzSearch}
                  searchPlaceholder='Search time zone...'
                  loading={tzLoading}
                  onChange={value => setFormState(prev => ({ ...prev, timeZoneId: value }))}
                />
              </div>
              <div className='space-y-2'>
                <Label>Listing</Label>
                <SearchableSelect
                  value={formState.listingId}
                  placeholder='Select listing'
                  options={listingOptions.map(option => ({
                    value: option.id,
                    label: option.name ? `${option.base} — ${option.name}` : option.base
                  }))}
                  searchValue={listingSearch}
                  onSearchChange={setListingSearch}
                  searchPlaceholder='Search listing...'
                  loading={listingLoading}
                  onChange={value => setFormState(prev => ({ ...prev, listingId: value }))}
                />
              </div>
            </div>

            <div className='flex flex-col gap-4'>
              <div className='flex flex-col overflow-hidden rounded-lg border bg-card'>
                <div className='flex items-center justify-between border-b px-4 py-2'>
                  <div>
                    <p className='text-sm font-medium'>Sessions</p>
                    <p className='text-xs text-muted-foreground'>Click and drag to add/adjust weekly sessions.</p>
                  </div>
                  <Button size='sm' variant='secondary' onClick={handleAddSession}>
                    <PlusIcon className='h-4 w-4' />
                    Add Session
                  </Button>
                </div>
                <div className='h-[420px] overflow-hidden'>
                  <ShadcnBigCalendar
                    localizer={localizer}
                    events={sessionEvents}
                    eventPropGetter={eventPropGetter as any}
                    defaultView='week'
                    views={['week']}
                    formats={calendarFormats}
                    step={30}
                    timeslots={2}
                    min={templateWeekStart.clone().startOf('day').toDate()}
                    max={templateWeekStart.clone().startOf('day').hour(23).minute(59).second(59).toDate()}
                    defaultDate={templateWeekStart.toDate()}
                    style={{ height: '100%' }}
                    selectable
                    onSelectSlot={slot => {
                      const id = `slot-${Date.now()}`
                      setSessionEvents(prev => [
                        ...prev,
                        {
                          id,
                          title: 'session',
                          start: slot.start,
                          end: slot.end,
                          state: 'session'
                        }
                      ])
                      setEditingSessionId(id)
                      setSessionEditorOpen(true)
                    }}
                    onSelectEvent={event => {
                      setEditingSessionId((event as SessionEvent).id)
                      setSessionEditorOpen(true)
                    }}
                  />
                </div>
              </div>
            </div>

            <div className='grid gap-4 md:grid-cols-2'>
              <div className='rounded-lg border bg-card p-3'>
                <div className='flex items-center justify-between mb-2'>
                  <p className='text-sm font-medium'>Holidays</p>
                  <Popover open={addHolidayOpen} onOpenChange={open => {
                    setAddHolidayOpen(open)
                    if (!open) setNewHolidayDate(undefined)
                  }}>
                    <PopoverTrigger asChild>
                      <Button size='icon' variant='secondary' aria-label='Add holiday'>
                        <PlusIcon className='h-4 w-4' />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className='p-3 space-y-3' align='end'>
                      <div className='text-sm font-medium'>Add holiday</div>
                      <Calendar
                        mode='single'
                        selected={newHolidayDate}
                        defaultMonth={newHolidayDate}
                        onSelect={setNewHolidayDate}
                        initialFocus
                      />
                      <div className='flex justify-end gap-2'>
                        <Button variant='outline' size='sm' onClick={() => { setAddHolidayOpen(false); setNewHolidayDate(undefined) }}>
                          Cancel
                        </Button>
                        <Button size='sm' onClick={handleSaveNewHoliday}>
                          Save
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
                <div className='space-y-2 max-h-52 overflow-auto pr-1'>
                  {holidays.map(h => (
                    <div key={h.id} className='flex items-center gap-2'>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant='outline'
                            className='w-full justify-start text-left font-normal'
                          >
                            {formatDateLabel(h.date)}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className='p-0' align='start'>
                          <Calendar
                            mode='single'
                            selected={toDateMaybe(h.date)}
                            defaultMonth={toDateMaybe(h.date)}
                            onSelect={date => {
                              const value = date ? moment(date).format('YYYY-MM-DD') : ''
                              setHolidays(prev => prev.map(x => (x.id === h.id ? { ...x, date: value } : x)))
                            }}
                            initialFocus
                          />
                        </PopoverContent>
                      </Popover>
                      <Button size='icon' variant='ghost' onClick={() => setHolidays(prev => prev.filter(x => x.id !== h.id))}>
                        <Trash2Icon className='h-4 w-4' />
                      </Button>
                    </div>
                  ))}
                  {!holidays.length && <p className='text-xs text-muted-foreground'>No holidays.</p>}
                </div>
              </div>
              <div className='rounded-lg border bg-card p-3'>
                <div className='flex items-center justify-between mb-2'>
                  <p className='text-sm font-medium'>Early closes</p>
                  <Popover open={addEarlyCloseOpen} onOpenChange={open => {
                    setAddEarlyCloseOpen(open)
                    if (!open) {
                      setNewEarlyCloseDate(undefined)
                      setNewEarlyCloseTime('')
                    }
                  }}>
                    <PopoverTrigger asChild>
                      <Button size='icon' variant='secondary' aria-label='Add early close'>
                        <PlusIcon className='h-4 w-4' />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className='p-3 space-y-3' align='end'>
                      <div className='text-sm font-medium'>Add early close</div>
                      <Calendar
                        mode='single'
                        selected={newEarlyCloseDate}
                        defaultMonth={newEarlyCloseDate}
                        onSelect={setNewEarlyCloseDate}
                        initialFocus
                      />
                      <div className='space-y-1'>
                        <Label className='text-xs'>Time (HH:MM)</Label>
                        <Input
                          type='text'
                          inputMode='numeric'
                          placeholder='HH:MM'
                          value={newEarlyCloseTime}
                          onChange={e => setNewEarlyCloseTime(e.target.value)}
                        />
                      </div>
                      <div className='flex justify-end gap-2'>
                        <Button variant='outline' size='sm' onClick={() => {
                          setAddEarlyCloseOpen(false)
                          setNewEarlyCloseDate(undefined)
                          setNewEarlyCloseTime('')
                        }}>
                          Cancel
                        </Button>
                        <Button size='sm' onClick={handleSaveNewEarlyClose}>
                          Save
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
                <div className='space-y-2 max-h-52 overflow-auto pr-1'>
                  {earlyCloses.map(ec => (
                    <div key={ec.id} className='grid grid-cols-10 items-center gap-2'>
                      <div className='col-span-6'>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              variant='outline'
                              className='w-full justify-start text-left font-normal'
                            >
                              {formatDateLabel(ec.date)}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent className='p-0' align='start'>
                            <Calendar
                              mode='single'
                              selected={toDateMaybe(ec.date)}
                              defaultMonth={toDateMaybe(ec.date)}
                              onSelect={date => {
                                const value = date ? moment(date).format('YYYY-MM-DD') : ''
                                setEarlyCloses(prev => prev.map(x => (x.id === ec.id ? { ...x, date: value } : x)))
                              }}
                              initialFocus
                            />
                          </PopoverContent>
                        </Popover>
                      </div>
                      <Input
                        type='text'
                        inputMode='numeric'
                        placeholder='HH:MM'
                        className='col-span-3'
                        value={ec.time}
                        onChange={e => {
                          const value = e.target.value
                          setEarlyCloses(prev => prev.map(x => (x.id === ec.id ? { ...x, time: value } : x)))
                        }}
                      />
                      <Button size='icon' variant='ghost' onClick={() => setEarlyCloses(prev => prev.filter(x => x.id !== ec.id))}>
                        <Trash2Icon className='h-4 w-4' />
                      </Button>
                    </div>
                  ))}
                  {!earlyCloses.length && <p className='text-xs text-muted-foreground'>No early closes.</p>}
                </div>
              </div>
            </div>
          </div>
          <EditDialogFooter
            onCancel={() => onOpenChange(false)}
            onSubmit={handleSave}
            submitType='button'
            submitDisabled={saving}
            cancelDisabled={saving}
            loading={saving}
            leftSlot={<FormError message={error} className='mr-auto' />}
          />
        </DialogContent>
      </Dialog>

      <Dialog open={sessionEditorOpen} onOpenChange={setSessionEditorOpen}>
        <DialogContent className='max-w-md'>
          <DialogHeader>
            <DialogTitle>Edit session</DialogTitle>
            <DialogDescription>Adjust the selected session.</DialogDescription>
          </DialogHeader>
          {editingSession ? (
            <div className='space-y-3'>
              <div className='space-y-1'>
                <Label className='text-xs'>State</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant='outline' className='w-full justify-between'>
                      <span className='truncate capitalize'>
                        {editingSession.state || 'Select state'}
                      </span>
                      <ChevronsUpDownIcon className='ml-2 h-4 w-4 opacity-50' />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className='w-[--radix-popper-anchor-width] p-0' align='start'>
                    <Command>
                      <CommandList>
                        <CommandGroup>
                          {sessionStateOptions.map(option => (
                            <CommandItem
                              key={option}
                              value={option}
                              onSelect={() => updateEditingSession({ state: option, title: option })}
                            >
                              <span className='capitalize'>{option}</span>
                              {editingSession.state === option && <CheckIcon className='ml-auto h-4 w-4' />}
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
              <div className='grid grid-cols-2 gap-2'>
                <div className='space-y-1'>
                  <Label className='text-xs'>Start</Label>
                  <Input
                    type='text'
                    inputMode='numeric'
                    placeholder='HH:MM'
                    value={`${pad2(editingSession.start.getHours())}:${pad2(editingSession.start.getMinutes())}`}
                    onChange={e => updateEditingSession({ start: parseTimeString(e.target.value, editingSession.start) })}
                  />
                </div>
                <div className='space-y-1'>
                  <Label className='text-xs'>End</Label>
                  <Input
                    type='text'
                    inputMode='numeric'
                    placeholder='HH:MM'
                    value={`${pad2(editingSession.end.getHours())}:${pad2(editingSession.end.getMinutes())}`}
                    onChange={e => updateEditingSession({ end: parseTimeString(e.target.value, editingSession.end) })}
                  />
                </div>
              </div>
              <div className='flex justify-between'>
                <Button variant='destructive' type='button' onClick={() => handleDeleteSession(editingSession.id)}>
                  Delete session
                </Button>
                <Button type='button' onClick={() => setSessionEditorOpen(false)}>
                  Done
                </Button>
              </div>
            </div>
          ) : (
            <p className='text-sm text-muted-foreground'>Select a session from the calendar to edit.</p>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
