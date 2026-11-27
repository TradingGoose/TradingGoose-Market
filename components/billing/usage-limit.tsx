'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, LoaderCircle, Pencil, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/ui/utils'
import { subscriptionKeys, subscriptionMutationOptions } from '@/hooks/queries/subscription'


interface UsageLimitProps {
  currentLimit: number
  currentUsage: number
  canEdit: boolean
  minimumLimit: number
}

export interface UsageLimitRef {
  startEdit: () => void
}

export const UsageLimit = forwardRef<UsageLimitRef, UsageLimitProps>(
  (
    { currentLimit, currentUsage, canEdit, minimumLimit },
    ref
  ) => {
    const [inputValue, setInputValue] = useState(currentLimit.toString())
    const [errorType, setErrorType] = useState<'general' | 'belowUsage' | null>(null)
    const hasError = errorType !== null
    const [isEditing, setIsEditing] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)
    const submitLockRef = useRef(false)
    const queryClient = useQueryClient()

    const updateUserLimitMutation = useMutation(
      subscriptionMutationOptions.updateUsageLimit(queryClient)
    )
    const sharedPending = useIsMutating({ mutationKey: subscriptionKeys.usage() }) > 0
    const isPending = updateUserLimitMutation.isPending || sharedPending
    const saving = () => queryClient.isMutating({ mutationKey: subscriptionKeys.usage() }) > 0

    const handleStartEdit = () => {
      if (!canEdit || isPending || saving()) return
      setErrorType(null)
      setIsEditing(true)
      setInputValue(currentLimit.toString())
    }

    useImperativeHandle(ref, () => ({ startEdit: handleStartEdit }))

    useEffect(() => {
      if (isEditing && inputRef.current) {
        inputRef.current.focus()
        inputRef.current.select()
      }
    }, [isEditing])

    const handleSubmit = async () => {
      if (submitLockRef.current || isPending || saving()) return

      const newLimit = Number.parseInt(inputValue, 10)

      if (Number.isNaN(newLimit) || newLimit < minimumLimit) {
        setInputValue(currentLimit.toString())
        setIsEditing(false)
        return
      }

      if (newLimit < currentUsage) {
        setErrorType('belowUsage')
        return
      }

      if (newLimit === currentLimit) {
        setIsEditing(false)
        return
      }

      submitLockRef.current = true
      try {
        await updateUserLimitMutation.mutateAsync(String(newLimit))

        setInputValue(newLimit.toString())
        setIsEditing(false)
        setErrorType(null)
      } catch (err) {

        const message = err instanceof Error ? err.message : String(err)
        setErrorType(message.includes('below current usage') ? 'belowUsage' : 'general')

        setInputValue(currentLimit.toString())
      } finally {
        submitLockRef.current = false
      }
    }

    const handleCancelEdit = () => {
      setIsEditing(false)
      setInputValue(currentLimit.toString())
      setErrorType(null)
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        handleSubmit()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        handleCancelEdit()
      }
    }

    return (
      <div className='space-y-1'>
        <div className='flex items-center'>
          {isEditing ? (
            <>
              <span className='text-muted-foreground text-xs tabular-nums'>$</span>
              <input
                ref={inputRef}
                type='number'
                data-escape-cancels-edit=''
                aria-label='Spending limit in USD'
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={(e) => {
                  const relatedTarget = e.relatedTarget as HTMLElement
                  if (relatedTarget?.closest('button')) {
                    return
                  }
                  void handleSubmit()
                }}
                className={cn(
                  'border-0 bg-transparent p-0 text-xs tabular-nums',
                  'outline-none focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 focus-visible:ring-offset-0',
                  '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none',
                  hasError && 'text-red-500'
                )}
                min={minimumLimit}
                step='1'
                disabled={isPending}
                autoComplete='off'
                autoCorrect='off'
                autoCapitalize='off'
                spellCheck='false'
                style={{ width: `${Math.max(3, inputValue.length)}ch` }}
              />
            </>
          ) : (
            <span className='text-muted-foreground text-xs tabular-nums'>${currentLimit}</span>
          )}
          {canEdit && (
            <Button
              variant='ghost'
              size='icon'
              className={cn(
                'ml-1 h-4 w-4 p-0 transition-colors hover:bg-transparent',
                hasError
                  ? 'text-red-500 hover:text-red-600'
                  : 'text-muted-foreground hover:text-foreground'
              )}
              onClick={isEditing ? handleSubmit : handleStartEdit}
              disabled={isPending}
              aria-busy={isPending || undefined}
            >
              {isPending ? (
                <LoaderCircle className='!h-3 !w-3 animate-spin' />
              ) : isEditing ? (
                hasError ? (
                  <X className='!h-3 !w-3' />
                ) : (
                  <Check className='!h-3 !w-3' />
                )
              ) : (
                <Pencil className='!h-3 !w-3' />
              )}
              <span className='sr-only'>
                {isPending ? 'Saving limit' : isEditing ? 'Save limit' : 'Edit limit'}
              </span>
            </Button>
          )}
        </div>
        {hasError ? (
          <p role='alert' className='text-destructive text-xs'>
            {errorType === 'belowUsage' ? 'Limit cannot be below current usage.' : 'Could not update the usage limit.'}
          </p>
        ) : null}
      </div>
    )
  }
)

UsageLimit.displayName = 'UsageLimit'
