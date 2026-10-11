import { openDatabase } from './database'
import { GroveStore } from './store'
import { GroveRelay } from './relay'
import { startGroveServer } from './http'

const connectionString = process.env.GROVE_DATABASE_URL
if (!connectionString) throw new Error('GROVE_DATABASE_URL is required')
const database = await openDatabase(connectionString)
try {
  const store = new GroveStore(database.database)
  if (process.argv[2] === 'create-user') {
    const name = process.argv[3]?.trim()
    if (!name) throw new Error('User name is required')
    process.stdout.write(JSON.stringify(await store.provisionUser(name)) + '\n')
    await database.close()
  } else {
    const server = await startGroveServer(store, new GroveRelay(database.database, store), {
      hostname: process.env.GROVE_HOST ?? '127.0.0.1',
      port: Number(process.env.GROVE_PORT ?? 43128),
    })
    process.stdout.write(`Grove listening on port ${server.port}\n`)
    const shutdown = async () => {
      await server.close()
      await database.close()
    }
    process.once('SIGINT', () => void shutdown())
    process.once('SIGTERM', () => void shutdown())
  }
} catch (error) {
  await database.close()
  throw error
}
