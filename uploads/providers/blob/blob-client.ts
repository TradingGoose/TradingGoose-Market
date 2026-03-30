import {
  BlobServiceClient,
  StorageSharedKeyCredential,
  type BlobDownloadResponseParsed
} from '@azure/storage-blob'

import { BLOB_CONFIG } from '../../core/setup'

export type FileInfo = {
  path: string
  key: string
  name: string
  size: number
  type: string
}

let blobServiceClient: BlobServiceClient | null = null

function getBlobServiceClient(): BlobServiceClient {
  if (blobServiceClient) return blobServiceClient

  const { accountName, accountKey, connectionString } = BLOB_CONFIG

  if (connectionString) {
    blobServiceClient = BlobServiceClient.fromConnectionString(connectionString)
  } else if (accountName && accountKey) {
    const sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey)
    blobServiceClient = new BlobServiceClient(
      `https://${accountName}.blob.core.windows.net`,
      sharedKeyCredential
    )
  } else {
    throw new Error(
      'Azure Blob Storage credentials are missing. Set AZURE_STORAGE_CONTAINER_NAME and either AZURE_CONNECTION_STRING or AZURE_ACCOUNT_NAME + AZURE_ACCOUNT_KEY.'
    )
  }

  return blobServiceClient
}

function sanitizeKey(key: string) {
  return key.replace(/\.\./g, '').replace(/^[\\/]+/, '').replace(/\\/g, '/')
}

async function ensureContainer(containerName: string) {
  const containerClient = getBlobServiceClient().getContainerClient(containerName)
  await containerClient.createIfNotExists()
  return containerClient
}

async function streamToBuffer(response: BlobDownloadResponseParsed): Promise<Buffer> {
  const stream = response.readableStreamBody
  if (!stream) return Buffer.alloc(0)

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    stream.on('data', (data) => {
      chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data))
    })
    stream.on('end', () => resolve(Buffer.concat(chunks)))
    stream.on('error', reject)
  })
}

export async function uploadToBlob(
  file: Buffer,
  key: string,
  contentType: string,
  size = file.length
): Promise<FileInfo> {
  const safeKey = sanitizeKey(key)
  const containerClient = await ensureContainer(BLOB_CONFIG.containerName)
  const blobClient = containerClient.getBlockBlobClient(safeKey)

  await blobClient.uploadData(file, {
    blobHTTPHeaders: { blobContentType: contentType },
    metadata: {
      originalName: encodeURIComponent(key),
      uploadedAt: new Date().toISOString()
    }
  })

  return {
    path: `/api/files/serve/${safeKey}`,
    key: safeKey,
    name: key.split('/').pop() || key,
    size,
    type: contentType
  }
}

export async function downloadFromBlob(key: string): Promise<Buffer> {
  const safeKey = sanitizeKey(key)
  const containerClient = getBlobServiceClient().getContainerClient(BLOB_CONFIG.containerName)
  const blobClient = containerClient.getBlockBlobClient(safeKey)
  const response = await blobClient.download()
  return streamToBuffer(response)
}

export async function deleteFromBlob(key: string): Promise<void> {
  const safeKey = sanitizeKey(key)
  const containerClient = getBlobServiceClient().getContainerClient(BLOB_CONFIG.containerName)
  const blobClient = containerClient.getBlockBlobClient(safeKey)
  await blobClient.deleteIfExists()
}

export async function listBlobKeys(prefix: string): Promise<string[]> {
  const safePrefix = sanitizeKey(prefix).replace(/^\/+/, '')
  if (!safePrefix) return []

  const containerClient = getBlobServiceClient().getContainerClient(BLOB_CONFIG.containerName)
  const keys: string[] = []

  for await (const blob of containerClient.listBlobsFlat({ prefix: safePrefix })) {
    if (blob.name) keys.push(blob.name)
  }

  return keys
}
