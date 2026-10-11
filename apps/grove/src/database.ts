import { readFile } from 'node:fs/promises'
import pg from 'pg'

export interface SqlConnection {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>
}

export interface GroveDatabase extends SqlConnection {
  transaction<T>(action: (connection: SqlConnection) => Promise<T>): Promise<T>
}

export async function openDatabase(connectionString: string) {
  const pool = new pg.Pool({ connectionString })
  const database: GroveDatabase = {
    query: (sql, values) => pool.query(sql, values),
    async transaction(action) {
      const connection = await pool.connect()
      try {
        await connection.query('BEGIN')
        const result = await action(connection)
        await connection.query('COMMIT')
        return result
      } catch (error) {
        await connection.query('ROLLBACK')
        throw error
      } finally {
        connection.release()
      }
    },
  }
  try {
    await database.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'))
  } catch (error) {
    await pool.end()
    throw error
  }
  return { database, close: () => pool.end() }
}
