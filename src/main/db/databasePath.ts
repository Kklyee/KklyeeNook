import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export function getDatabasePath(): string {
  const databaseDirectory = join(app.getAppPath(), 'data')
  mkdirSync(databaseDirectory, { recursive: true })

  return join(databaseDirectory, 'kklyeenook.db')
}

export function getDatabaseUrl(): string {
  return pathToFileURL(getDatabasePath()).href
}

export function getMigrationsPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'drizzle') : join(app.getAppPath(), 'drizzle')
}
