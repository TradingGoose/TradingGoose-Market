// Minimal upload configuration with explicit storage selection
export const UPLOAD_DIR = '/uploads'

export type StorageService = 'local' | 'vercel' | 'azure'

const STORAGE_SERVICE_ENV = (process.env.STORAGE_SERVICE || '').trim().toUpperCase()
const hasVercelBlobConfig = Boolean(process.env.BLOB_READ_WRITE_TOKEN)
const hasAzureBlobConfig = Boolean(
  process.env.AZURE_STORAGE_CONTAINER_NAME &&
    ((process.env.AZURE_ACCOUNT_NAME && process.env.AZURE_ACCOUNT_KEY) ||
      process.env.AZURE_CONNECTION_STRING)
)

const serviceFromEnv: StorageService | null =
  STORAGE_SERVICE_ENV === 'VERCEL'
    ? 'vercel'
    : STORAGE_SERVICE_ENV === 'AZURE'
      ? 'azure'
      : STORAGE_SERVICE_ENV === 'LOCAL'
        ? 'local'
        : null

function resolveStorageService(): StorageService {
  if (serviceFromEnv) return serviceFromEnv

  if (hasVercelBlobConfig && !hasAzureBlobConfig) return 'vercel'
  if (hasAzureBlobConfig && !hasVercelBlobConfig) return 'azure'

  return 'local'
}

export const STORAGE_SERVICE: StorageService = resolveStorageService()
export const USE_VERCEL_BLOB_STORAGE = STORAGE_SERVICE === 'vercel'
export const USE_BLOB_STORAGE = STORAGE_SERVICE === 'azure'

if (STORAGE_SERVICE_ENV && !serviceFromEnv) {
  console.warn(
    `Unknown STORAGE_SERVICE "${STORAGE_SERVICE_ENV}". Expected LOCAL, VERCEL, or AZURE. Falling back to auto-detection.`
  )
}

if (serviceFromEnv === 'vercel' && !hasVercelBlobConfig) {
  console.warn('STORAGE_SERVICE=VERCEL but BLOB_READ_WRITE_TOKEN is not set.')
}

if (serviceFromEnv === 'azure' && !hasAzureBlobConfig) {
  console.warn(
    'STORAGE_SERVICE=AZURE but Azure storage credentials are missing. Set AZURE_STORAGE_CONTAINER_NAME and either AZURE_CONNECTION_STRING or AZURE_ACCOUNT_NAME + AZURE_ACCOUNT_KEY.'
  )
}

if (!serviceFromEnv && hasVercelBlobConfig && hasAzureBlobConfig) {
  console.warn(
    'Multiple storage credentials detected (Vercel + Azure). Set STORAGE_SERVICE to choose a provider.'
  )
}

export const BLOB_CONFIG = {
  accountName: process.env.AZURE_ACCOUNT_NAME || '',
  accountKey: process.env.AZURE_ACCOUNT_KEY || '',
  connectionString: process.env.AZURE_CONNECTION_STRING || '',
  containerName: process.env.AZURE_STORAGE_CONTAINER_NAME || ''
}

export function getStorageProvider(): StorageService {
  return STORAGE_SERVICE
}

export function isUsingCloudStorage(): boolean {
  return STORAGE_SERVICE !== 'local'
}
