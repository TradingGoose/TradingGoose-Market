'use client'

import { useEffect, useState, type FormEvent } from 'react'

import { EditDialogFooter, EditDialogHeader, FormError } from '@/components/edit-dialog'
import {
  Dialog,
  DialogContent
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { TimeZoneRow } from './types'

type TimeZoneEditDialogProps = {
  timeZone: TimeZoneRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (timeZone: TimeZoneRow) => void
  mode?: 'edit' | 'create'
}

type TimeZoneFormState = {
  name: string
  offset: string
  offsetDst: string
  observesDst: boolean
}

export function TimeZoneEditDialog({
  timeZone,
  open,
  onOpenChange,
  onSave,
  mode = 'edit'
}: TimeZoneEditDialogProps) {
  const isEdit = mode === 'edit' && !!timeZone

  const [formState, setFormState] = useState<TimeZoneFormState>({
    name: '',
    offset: '',
    offsetDst: '',
    observesDst: false
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    if (timeZone) {
      setFormState({
        name: timeZone.name,
        offset: timeZone.offset,
        offsetDst: timeZone.offsetDst ?? '',
        observesDst: timeZone.observesDst ?? false
      })
    } else {
      setFormState({ name: '', offset: '', offsetDst: '', observesDst: false })
    }
    setError(null)
  }, [timeZone, open])

  const isFormValid =
    formState.name.trim().length > 0 &&
    formState.offset.trim().length > 0 &&
    (!formState.observesDst || formState.offsetDst.trim().length > 0) &&
    !saving

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!formState.name.trim() || !formState.offset.trim()) {
      setError('Name and offset are required.')
      return
    }
    if (formState.observesDst && !formState.offsetDst.trim()) {
      setError('DST offset is required when daylight saving time is enabled.')
      return
    }

    try {
      setSaving(true)
      setError(null)

      const payload = {
        name: formState.name.trim(),
        offset: formState.offset.trim(),
        offsetDst: formState.observesDst ? formState.offsetDst.trim() : null,
        observesDst: formState.observesDst
      }

      const response = isEdit
        ? await fetch(`/api/time-zones/${timeZone!.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          })
        : await fetch('/api/time-zones', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          })

      if (!response.ok) {
        const message = await response
          .json()
          .then(body => body?.error ?? 'Failed to save time zone.')
          .catch(() => 'Failed to save time zone.')
        throw new Error(message)
      }

      const result = (await response.json()) as { data: TimeZoneRow | null }
      if (!result.data) {
        throw new Error('Time zone could not be loaded after save.')
      }

      onSave(result.data)
      onOpenChange(false)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to save time zone.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={nextOpen => onOpenChange(nextOpen)}>
      <DialogContent className='max-w-xl'>
        <EditDialogHeader
          title={isEdit ? 'Edit Time Zone' : 'Add Time Zone'}
          description={isEdit ? 'Update time zone details.' : 'Create a new time zone.'}
        />
        <form className='space-y-6' onSubmit={handleSubmit}>
          <div className='grid gap-4 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label htmlFor='timezone-name'>Name <span className='text-destructive'>*</span></Label>
              <Input
                id='timezone-name'
                value={formState.name}
                onChange={event => setFormState(prev => ({ ...prev, name: event.target.value }))}
                placeholder='America/New_York'
                required
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='timezone-offset'>Offset <span className='text-destructive'>*</span></Label>
              <Input
                id='timezone-offset'
                value={formState.offset}
                onChange={event => setFormState(prev => ({ ...prev, offset: event.target.value }))}
                placeholder='+00:00'
                required
              />
            </div>
            <div className='space-y-2'>
              <Label>Observes DST</Label>
              <div className='flex items-center justify-between rounded-md border px-3 py-2'>
                <div className='space-y-0.5'>
                  <p className='text-sm font-medium leading-none'>Daylight saving time</p>
                  <p className='text-xs text-muted-foreground'>Enable to store a DST offset.</p>
                </div>
                <Switch
                  checked={formState.observesDst}
                  onCheckedChange={checked => {
                    setFormState(prev => ({
                      ...prev,
                      observesDst: checked,
                      offsetDst: checked ? prev.offsetDst : ''
                    }))
                  }}
                />
              </div>
            </div>
            <div className='space-y-2'>
              <Label htmlFor='timezone-offset-dst'>DST Offset</Label>
              <Input
                id='timezone-offset-dst'
                value={formState.offsetDst}
                onChange={event => setFormState(prev => ({ ...prev, offsetDst: event.target.value }))}
                placeholder='-04:00'
                disabled={!formState.observesDst}
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
