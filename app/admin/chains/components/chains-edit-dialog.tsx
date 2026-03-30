'use client'

import { useEffect, useState, type FormEvent } from 'react'

import { EditDialogFooter, EditDialogHeader, FormError, IconUploadField } from '@/components/edit-dialog'
import {
  Dialog,
  DialogContent
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { type FileWithPreview } from '@/hooks/use-file-upload'
import { ChainRow } from './types'

type ChainEditDialogProps = {
  chain: ChainRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (chain: ChainRow) => void
  mode?: 'edit' | 'create'
}

type ChainFormState = {
  code: string
  name: string
  iconUrl: string
}

export function ChainEditDialog({ chain, open, onOpenChange, onSave, mode = 'edit' }: ChainEditDialogProps) {
  const chainId = chain?.id?.trim() ?? ''
  const isEdit = mode === 'edit' && chainId.length > 0

  const [formState, setFormState] = useState<ChainFormState>({
    code: '',
    name: '',
    iconUrl: ''
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [iconUploading, setIconUploading] = useState(false)
  const [iconError, setIconError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    if (chain) {
      setFormState({
        code: chain.code,
        name: chain.name,
        iconUrl: chain.iconUrl ?? ''
      })
    } else {
      setFormState({ code: '', name: '', iconUrl: '' })
    }
    setError(null)
    setIconError(null)
  }, [chain, open])

  const isFormValid = formState.code.trim().length >= 1 && formState.name.trim().length > 0 && !saving

  const handleIconUpload = async (file: File) => {
    if (!chain || !chainId) {
      setIconError('Save the chain before uploading an icon.')
      return
    }

    setIconError(null)
    setIconUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('chainId', chainId)
      formData.append('code', formState.code || chain.code)

      const response = await fetch('/api/uploads/chain-icon', {
        method: 'POST',
        body: formData
      })

      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body?.error ?? 'Failed to upload icon.')
      }

      const payload = (await response.json()) as { data: { url: string } }
      setFormState(prev => ({ ...prev, iconUrl: payload.data.url }))
      onSave({ ...chain, iconUrl: payload.data.url })
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

    if (mode === 'edit' && !chainId) {
      setError('Chain id is required.')
      return
    }

    try {
      setSaving(true)
      setError(null)
      const payload = {
        code: formState.code.trim(),
        name: formState.name.trim(),
        iconUrl: formState.iconUrl.trim() || null
      }

      const response = isEdit
        ? await fetch(`/api/chains/${chainId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          })
        : await fetch(`/api/chains`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          })

      if (!response.ok) {
        const message = await response
          .json()
          .then(body => body?.error ?? 'Failed to save chain.')
          .catch(() => 'Failed to save chain.')
        throw new Error(message)
      }

      const result = (await response.json()) as { data: ChainRow | null }
      if (!result.data) {
        throw new Error('Chain could not be loaded after save.')
      }

      onSave(result.data)
      onOpenChange(false)
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to save chain.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={nextOpen => onOpenChange(nextOpen)}>
      <DialogContent className='max-w-2xl'>
        <EditDialogHeader
          title={isEdit ? 'Edit Chain' : 'Add Chain'}
          description={isEdit ? 'Update chain details.' : 'Create a new chain.'}
        />
        <form className='space-y-6' onSubmit={handleSubmit}>
          <div className='grid gap-4 md:grid-cols-2'>
            <div className='space-y-2'>
              <Label htmlFor='chain-code'>Code <span className='text-destructive'>*</span></Label>
              <Input
                id='chain-code'
                value={formState.code}
                onChange={event => setFormState(prev => ({ ...prev, code: event.target.value.toUpperCase() }))}
                placeholder='e.g., ETH'
                required
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='chain-name'>Name <span className='text-destructive'>*</span></Label>
              <Input
                id='chain-name'
                value={formState.name}
                onChange={event => setFormState(prev => ({ ...prev, name: event.target.value }))}
                placeholder='Ethereum'
                required
              />
            </div>
          </div>

          <IconUploadField
            isEdit={isEdit}
            defaultAvatar={formState.iconUrl || undefined}
            onFileChange={handleAvatarChange}
            uploading={iconUploading}
            error={iconError}
            emptyMessage='Save the chain first to upload an icon.'
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
