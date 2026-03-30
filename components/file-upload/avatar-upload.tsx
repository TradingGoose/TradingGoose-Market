'use client'

import { useMemo } from 'react'

import { useFileUpload, type FileWithPreview } from '@/hooks/use-file-upload'
import { Alert, AlertContent, AlertDescription, AlertIcon } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { TriangleAlert, Plus, X } from 'lucide-react'
import { cn } from '@/lib/ui/utils'

interface AvatarUploadProps {
  maxSize?: number
  className?: string
  onFileChange?: (file: FileWithPreview | null) => void
  defaultAvatar?: string
}

export default function AvatarUpload({
  maxSize = 2 * 1024 * 1024, // 2MB
  className,
  onFileChange,
  defaultAvatar
}: AvatarUploadProps) {
  const [
    { files, isDragging, errors },
    { removeFile, handleDragEnter, handleDragLeave, handleDragOver, handleDrop, openFileDialog, getInputProps }
  ] = useFileUpload({
    maxFiles: 1,
    maxSize,
    accept: 'image/*',
    multiple: false,
    onFilesAdded: addedFiles => {
      onFileChange?.(addedFiles[0] ?? null)
    }
  })

  const currentFile = files[0]
  const normalizedDefaultAvatar = useMemo(() => {
    if (!defaultAvatar) return undefined
    const trimmed = defaultAvatar.trim()
    if (!trimmed) return undefined
    if (
      trimmed.startsWith('http://') ||
      trimmed.startsWith('https://') ||
      trimmed.startsWith('data:') ||
      trimmed.startsWith('blob:')
    ) {
      return trimmed
    }
    if (trimmed.startsWith('/api/files/serve/')) {
      return trimmed
    }
    if (trimmed.startsWith('api/files/serve/')) {
      return `/${trimmed}`
    }
    return `/api/files/serve/${trimmed.replace(/^\/+/, '')}`
  }, [defaultAvatar])
  const previewUrl = currentFile?.preview || normalizedDefaultAvatar
  const hasImage = !!previewUrl

  const handleRemove = () => {
    if (currentFile) {
      removeFile(currentFile.id)
      onFileChange?.(null)
      return
    }
    // Clear default avatar state when no file is selected.
    onFileChange?.(null)
  }

  return (
    <div className={cn('flex items-center gap-4', className)}>
      {/* Avatar Preview */}
      <div className='relative'>
        <div
          className={cn(
            'group/avatar relative h-10 w-10 cursor-pointer overflow-hidden rounded-full border-2 border-dashed transition-colors',
            isDragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-muted-foreground/20',
            previewUrl && 'border-solid'
          )}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={openFileDialog}
        >
          <input {...getInputProps()} className='sr-only' />

          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt='Avatar' className='h-full w-full object-cover' />
          ) : (
            <div className='flex h-full w-full items-center justify-center'>
              <Plus className='size-6 text-muted-foreground' />
            </div>
          )}
        </div>

        {/* Remove Button - only show when file is uploaded */}
        {hasImage && (
          <Button
            size='icon'
            variant='destructive'
            onClick={handleRemove}
            className='size-4 absolute end-0 top-0 rounded-full'
            aria-label='Remove avatar'
          >
            <X className='size-3.5' />
          </Button>
        )}
      </div>

      {/* Error Messages */}
      {errors.length > 0 && (
        <Alert variant='destructive' appearance='light' className='p-2 h-10'>
          <AlertIcon>
            <TriangleAlert />
          </AlertIcon>
          <AlertContent>
            <AlertDescription>
              {errors.map((error, index) => (
                <p key={index} className='last:mb-0'>
                  {error}
                </p>
              ))}
            </AlertDescription>
          </AlertContent>
        </Alert>
      )}
    </div>
  )
}
