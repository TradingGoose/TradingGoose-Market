'use client'

import { useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'

import { EditDialogFooter, EditDialogHeader, FormError, IconUploadField } from '@/components/edit-dialog'
import {
  Dialog,
  DialogContent
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { type FileWithPreview } from '@/hooks/use-file-upload'
import { CountryRow } from './types'

type CountryEditDialogProps = {
  country: CountryRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (country: CountryRow) => void
  mode?: 'edit' | 'create'
}

type CountryFormState = {
  code: string
  name: string
  iconUrl: string | null
}

type CountryEditDialogContentProps = CountryEditDialogProps & {
  saving: boolean
  setSaving: Dispatch<SetStateAction<boolean>>
  iconUploading: boolean
  setIconUploading: Dispatch<SetStateAction<boolean>>
}

const createCountryFormState = (country: CountryRow | null): CountryFormState => ({
  code: country?.code ?? '',
  name: country?.name ?? '',
  iconUrl: country?.iconUrl ?? null
})

export function CountryEditDialog(props: CountryEditDialogProps) {
  const { country, open, onOpenChange, mode = 'edit' } = props
  const [saving, setSaving] = useState(false)
  const [iconUploading, setIconUploading] = useState(false)
  const sessionKey = `${mode}:${country?.id ?? 'new'}`

  return (
    <Dialog
      open={open}
      onOpenChange={nextOpen => {
        if (!saving && !iconUploading) onOpenChange(nextOpen)
      }}
    >
      <DialogContent className='max-w-xl'>
        <CountryEditDialogContent
          key={`${sessionKey}:${open ? 'open' : 'closed'}`}
          {...props}
          saving={saving}
          setSaving={setSaving}
          iconUploading={iconUploading}
          setIconUploading={setIconUploading}
        />
      </DialogContent>
    </Dialog>
  )
}

function CountryEditDialogContent({
  country,
  onOpenChange,
  onSave,
  mode = 'edit',
  saving,
  setSaving,
  iconUploading,
  setIconUploading
}: CountryEditDialogContentProps) {
  const isEdit = mode === 'edit' && !!country

  const [formState, setFormState] = useState<CountryFormState>(() => createCountryFormState(country))
  const [error, setError] = useState<string | null>(null)
  const [iconError, setIconError] = useState<string | null>(null)

  const isFormValid = formState.code.trim().length >= 2 && formState.name.trim().length > 0 && !saving

  const handleIconUpload = async (file: File) => {
    if (!country) {
      setIconError('Save the country before uploading an icon.')
      return
    }

    setIconError(null)
    setIconUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('countryId', country.id)
      formData.append('code', formState.code || country.code)

      const response = await fetch('/api/uploads/country-icon', {
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
    if (!formState.code.trim() || !formState.name.trim()) {
      setError('Code and name are required.')
      return
    }

    try {
      setSaving(true)
      setError(null)
      const iconUrlPayload = formState.iconUrl ? undefined : null
      const payload = {
        code: formState.code.trim(),
        name: formState.name.trim(),
        iconUrl: iconUrlPayload
      }

      const response = isEdit
        ? await fetch(`/api/countries/${country!.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          })
        : await fetch(`/api/countries`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          })

      if (!response.ok) {
        const message = await response
          .json()
          .then(body => body?.error ?? 'Failed to save country.')
          .catch(() => 'Failed to save country.')
        throw new Error(message)
      }

      const result = (await response.json()) as { data: CountryRow | null }
      if (!result.data) {
        throw new Error('Country could not be loaded after save.')
      }

      onSave(result.data)
      onOpenChange(false)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to save country.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
        <EditDialogHeader
          title={isEdit ? 'Edit Country' : 'Add Country'}
          description={isEdit ? 'Update country details.' : 'Create a new country entry.'}
        />
        <form className='space-y-6' onSubmit={handleSubmit} aria-busy={saving || iconUploading}>
          <div className='grid gap-4 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label htmlFor='country-code'>Code <span className='text-destructive'>*</span></Label>
              <Input
                id='country-code'
                value={formState.code}
                onChange={event => setFormState(prev => ({ ...prev, code: event.target.value.toUpperCase() }))}
                placeholder='e.g., US'
                required
                autoComplete='off'
                disabled={saving}
              />
            </div>
            <IconUploadField
              isEdit={isEdit}
              defaultAvatar={formState.iconUrl || undefined}
              onFileChange={handleAvatarChange}
              uploading={iconUploading}
              error={iconError}
              emptyMessage='Save the country first to upload an icon.'
              avatarKey={country?.id ?? 'new'}
            />
            <div className='space-y-2 md:col-span-2'>
              <Label htmlFor='country-name'>Name <span className='text-destructive'>*</span></Label>
              <Input
                id='country-name'
                value={formState.name}
                onChange={event => setFormState(prev => ({ ...prev, name: event.target.value }))}
                placeholder='United States'
                required
                autoComplete='off'
                disabled={saving}
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
    </>
  )
}
