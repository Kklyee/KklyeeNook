import { drizzle } from 'drizzle-orm/libsql'

function createDatabase(url: string) {
  return drizzle(url)
}

export type Database = ReturnType<typeof createDatabase>

export async function connectDatabase(url: string) {
  const database = createDatabase(url)

  try {
    await database.$client.execute('PRAGMA foreign_keys = ON')
    await database.$client.execute('select 1')
  } catch (error) {
    database.$client.close()
    throw error
  }

  return { database, close: () => database.$client.close() }
}
