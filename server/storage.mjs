// Room persistence. With DATABASE_URL set, boards are stored in Postgres
// (e.g. a free Neon database) and survive restarts of hosts whose disk is
// wiped; otherwise they are stored as files in DATA_DIR.

import fs from 'node:fs'
import path from 'node:path'

const TABLE = 'planche_rooms'

class DiskStore {
  constructor (dir) {
    this.dir = dir
    fs.mkdirSync(dir, { recursive: true })
  }

  describe () { return `disque (${this.dir})` }

  async load (name) {
    const file = path.join(this.dir, `${name}.ybin`)
    return fs.existsSync(file) ? fs.readFileSync(file) : null
  }

  async save (name, state) {
    const file = path.join(this.dir, `${name}.ybin`)
    fs.writeFileSync(`${file}.tmp`, state)
    fs.renameSync(`${file}.tmp`, file)
  }
}

/** `db` is anything with `query(sql, params) -> { rows }` (pg.Pool, PGlite…). */
export class PgStore {
  constructor (db, label = 'Postgres') {
    this.db = db
    this.label = label
    this.ready = db.query(`CREATE TABLE IF NOT EXISTS ${TABLE} (
      name text PRIMARY KEY,
      state bytea NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    )`)
  }

  describe () { return this.label }

  async load (name) {
    await this.ready
    const { rows } = await this.db.query(`SELECT state FROM ${TABLE} WHERE name = $1`, [name])
    return rows[0] ? rows[0].state : null
  }

  async save (name, state) {
    await this.ready
    await this.db.query(
      `INSERT INTO ${TABLE} (name, state, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (name) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
      [name, state]
    )
  }
}

export async function createStore ({ databaseUrl, dataDir }) {
  if (!databaseUrl) return new DiskStore(dataDir)
  const { default: pg } = await import('pg')
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    // Hosted Postgres (Neon, Supabase…) requires TLS.
    ssl: /localhost|127\.0\.0\.1/.test(databaseUrl) ? false : { rejectUnauthorized: false },
    max: 4,
    idleTimeoutMillis: 30000
  })
  pool.on('error', (e) => console.error('[db]', e.message))
  const host = new URL(databaseUrl).hostname
  return new PgStore(pool, `Postgres (${host})`)
}
