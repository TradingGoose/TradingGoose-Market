import { del, head, list, put } from '@vercel/blob'

export type FileInfo = {
  path: string
  key: string
  name: string
  size: number
  type: string
}

function sanitizeKey(key: string) {
  return key.replace(/\.\./g, '').replace(/^[\\/]+/, '').replace(/\\/g, '/')
}

export async function uploadToVercelBlob(
  file: Buffer,
  key: string,
  contentType: string,
  size = file.length
): Promise<FileInfo> {
  const safeKey = sanitizeKey(key)

  const result = await put(safeKey, file, {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType
  })

  const pathname = result.pathname.replace(/^\/+/, '')

  return {
    path: `/api/files/serve/${pathname}`,
    key: pathname,
    name: key.split('/').pop() || key,
    size,
    type: result.contentType || contentType
  }
}

function normalizeKeyOrUrl(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return trimmed
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed
  if (trimmed.startsWith('blob/')) return trimmed.slice('blob/'.length)
  if (trimmed.startsWith('vercel/')) return trimmed.slice('vercel/'.length)
  return trimmed
}

export async function downloadFromVercelBlob(keyOrUrl: string): Promise<Buffer> {
  const normalized = normalizeKeyOrUrl(keyOrUrl)
  let result: Awaited<ReturnType<typeof head>>
  try {
    result = await head(normalized)
  } catch (error) {
    if (!normalized.startsWith('/') && !normalized.startsWith('http')) {
      result = await head(`/${normalized}`)
    } else {
      throw error
    }
  }
  const response = await fetch(result.url)
  if (!response.ok) {
    throw new Error(`Failed to download blob: ${response.status}`)
  }
  return Buffer.from(await response.arrayBuffer())
}

export async function deleteFromVercelBlob(keyOrUrl: string): Promise<void> {
  await del(keyOrUrl)
}

export async function listVercelBlobKeys(prefix: string): Promise<string[]> {
  const safePrefix = sanitizeKey(prefix).replace(/^\/+/, '')
  if (!safePrefix) return []

  const keys: string[] = []
  let cursor: string | undefined
  let hasMore = true

  while (hasMore) {
    const result = await list({ prefix: safePrefix, cursor, limit: 1000 })
    keys.push(...result.blobs.map((blob) => blob.pathname.replace(/^\/+/, '')))
    cursor = result.cursor
    hasMore = result.hasMore && Boolean(cursor)
  }

  return keys
}
