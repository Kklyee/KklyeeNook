import { app } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export function getDatabasePath(): string {
  return join(app.getPath('userData'), 'kklyeenook.db')
}

export function getDatabaseUrl(): string {
  return pathToFileURL(getDatabasePath()).href
}
