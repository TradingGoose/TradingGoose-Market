import { existsSync } from 'fs'
import { mkdir } from 'fs/promises'
import path, { join } from 'path'

import { getStorageProvider } from "./setup";

const PROJECT_ROOT = path.resolve(process.cwd())
export const UPLOAD_DIR_SERVER = join(PROJECT_ROOT, 'uploads')

/**
 * Ensure the local uploads directory exists. No-ops for cloud providers.
 */
export async function ensureUploadsDirectory() {
  if (getStorageProvider() !== 'local') return true

  try {
    if (!existsSync(UPLOAD_DIR_SERVER)) {
      await mkdir(UPLOAD_DIR_SERVER, { recursive: true })
    }
    return true
  } catch (error) {
    console.error('Failed to initialize uploads directory', error)
    return false
  }
}

// Run once on import (server only)
if (typeof process !== 'undefined') {
  ensureUploadsDirectory().catch(() => {
    // already logged inside helper
  })
}

export default ensureUploadsDirectory
