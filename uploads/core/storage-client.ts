import { promises as fs } from 'fs'
import { dirname, join, resolve, sep } from 'path'
import { randomUUID } from 'crypto'

import { ensureUploadsDirectory, UPLOAD_DIR_SERVER } from "./setup.server";
import { getStorageProvider, type StorageService } from "./setup";

export type FileInfo = {
  path: string
  key: string
  name: string
  size: number
  type: string
}

export type StorageProvider = StorageService

const SERVE_PREFIX = '/api/files/serve/'

function decodeKey(key: string) {
  try {
    return decodeURIComponent(key)
  } catch {
    return key
  }
}

function sanitizeKey(key: string) {
  return key.replace(/\.\./g, '').replace(/^[\\/]+/, '').replace(/\\/g, '/')
}

async function listLocalKeysByPrefix(prefix: string): Promise<string[]> {
  const normalizedPrefix = sanitizeKey(prefix).replace(/\/+$/, '')
  if (!normalizedPrefix) return []

  await ensureUploadsDirectory()

  const baseDir = join(UPLOAD_DIR_SERVER, normalizedPrefix)
  try {
    const stats = await fs.stat(baseDir)
    if (!stats.isDirectory()) return []
  } catch (error: any) {
    if (error?.code === 'ENOENT') return []
    throw error
  }

  const keys: string[] = []

  const walk = async (dir: string, relative: string) => {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const entryPath = join(dir, entry.name)
      const relativePath = relative ? `${relative}/${entry.name}` : entry.name

      if (entry.isDirectory()) {
        await walk(entryPath, relativePath)
      } else {
        keys.push(`${normalizedPrefix}/${relativePath}`)
      }
    }
  }

  await walk(baseDir, '')
  return keys
}

async function listKeysByPrefix(prefix: string, provider?: StorageProvider): Promise<string[]> {
  const resolvedProvider = provider ?? getStorageProvider()

  if (resolvedProvider === 'vercel') {
    const { listVercelBlobKeys } = await import('../providers/vercel/blob-client')
    return listVercelBlobKeys(prefix)
  }

  if (resolvedProvider === 'azure') {
    const { listBlobKeys } = await import('../providers/blob/blob-client')
    return listBlobKeys(prefix)
  }

  return listLocalKeysByPrefix(prefix)
}

function resolveStorageTarget(
  key: string,
  provider?: StorageProvider
): { provider: StorageProvider; key: string } {
  const trimmed = key.trim().replace(/^\/+/, '')
  const resolvedProvider = provider ?? getStorageProvider()

  return { provider: resolvedProvider, key: decodeKey(trimmed) }
}

export function extractStorageKey(path: string | null | undefined) {
  if (!path) return null
  const trimmed = path.trim()
  if (!trimmed) return null

  const index = trimmed.indexOf(SERVE_PREFIX)
  if (index === -1) return null

  let keyPart = trimmed.slice(index + SERVE_PREFIX.length)
  if (!keyPart) return null

  keyPart = keyPart.split('?')[0]
  keyPart = keyPart.replace(/^\/+/, '')
  if (keyPart.startsWith('blob/')) keyPart = keyPart.slice('blob/'.length)
  if (keyPart.startsWith('vercel/')) keyPart = keyPart.slice('vercel/'.length)

  return resolveStorageTarget(keyPart)
}

/**
 * Upload a file buffer to local storage.
 */
export async function uploadFile(
  file: Buffer,
  fileName: string,
  contentType: string,
  size?: number
): Promise<FileInfo> {
  const safeFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_').replace(/\.\./g, '')
  const key = `${randomUUID()}-${safeFileName || 'file'}`
  return uploadFileWithKey(file, key, contentType, size)
}

/**
 * Upload with a predetermined storage key (allows deterministic paths).
 */
export async function uploadFileWithKey(
  file: Buffer,
  key: string,
  contentType: string,
  size?: number
): Promise<FileInfo> {
  const safeKey = sanitizeKey(key)
  const provider = getStorageProvider()

  if (provider === 'vercel') {
    const { uploadToVercelBlob } = await import('../providers/vercel/blob-client')
    return uploadToVercelBlob(file, safeKey, contentType, size ?? file.length)
  }

  if (provider === 'azure') {
    const { uploadToBlob } = await import('../providers/blob/blob-client')
    return uploadToBlob(file, safeKey, contentType, size ?? file.length)
  }

  await ensureUploadsDirectory()

  const filePath = join(UPLOAD_DIR_SERVER, safeKey)

  // ensure nested directories exist
  await fs.mkdir(dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, file)

  return {
    path: `/api/files/serve/${safeKey}`,
    key: safeKey,
    name: key.split('/').pop() || key,
    size: size ?? file.length,
    type: contentType
  }
}

/**
 * Download a file by key.
 */
export async function downloadFile(key: string, provider?: StorageProvider): Promise<Buffer> {
  const resolved = resolveStorageTarget(key, provider)
  const safeKey = sanitizeKey(resolved.key)

  if (resolved.provider === 'vercel') {
    const { downloadFromVercelBlob } = await import('../providers/vercel/blob-client')
    return downloadFromVercelBlob(safeKey)
  }

  if (resolved.provider === 'azure') {
    const { downloadFromBlob } = await import('../providers/blob/blob-client')
    return downloadFromBlob(safeKey)
  }

  const filePath = join(UPLOAD_DIR_SERVER, safeKey)

  // guard against path traversal
  const resolvedPath = resolve(filePath)
  const allowed = resolve(UPLOAD_DIR_SERVER)
  if (!resolvedPath.startsWith(allowed + sep) && resolvedPath !== allowed) {
    throw new Error('Invalid file path')
  }

  return fs.readFile(filePath)
}

/**
 * Delete a file by key.
 */
export async function deleteFile(key: string, provider?: StorageProvider): Promise<void> {
  const resolved = resolveStorageTarget(key, provider)
  const safeKey = sanitizeKey(resolved.key)

  if (resolved.provider === 'vercel') {
    const { deleteFromVercelBlob } = await import('../providers/vercel/blob-client')
    await deleteFromVercelBlob(safeKey)
    return
  }

  if (resolved.provider === 'azure') {
    const { deleteFromBlob } = await import('../providers/blob/blob-client')
    await deleteFromBlob(safeKey)
    return
  }

  const filePath = join(UPLOAD_DIR_SERVER, safeKey)

  const resolvedPath = resolve(filePath)
  const allowed = resolve(UPLOAD_DIR_SERVER)
  if (!resolvedPath.startsWith(allowed + sep) && resolvedPath !== allowed) {
    throw new Error('Invalid file path')
  }

  try {
    await fs.unlink(filePath)
  } catch (error: any) {
    if (error?.code === 'ENOENT') return
    throw error
  }
}

export async function deleteFilesContaining(
  prefix: string,
  match: string,
  options?: { excludeKey?: string; provider?: StorageProvider }
): Promise<void> {
  const trimmed = match.trim()
  if (!trimmed) return

  const resolvedProvider = options?.provider ?? getStorageProvider()
  let keys: string[]

  try {
    keys = await listKeysByPrefix(prefix, resolvedProvider)
  } catch {
    return
  }

  const excludeKey = options?.excludeKey
    ? sanitizeKey(options.excludeKey).replace(/^\/+/, '')
    : null

  await Promise.all(
    keys
      .filter((key) => {
        const fileName = key.split('/').pop() ?? key
        return fileName.includes(trimmed) && (!excludeKey || key !== excludeKey)
      })
      .map(async (key) => {
        try {
          await deleteFile(key, resolvedProvider)
        } catch {
          // ignore cleanup errors
        }
      })
  )
}

export function getServePathPrefix(): string {
  return '/api/files/serve/'
}
