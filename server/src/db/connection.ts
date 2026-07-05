import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

type DatabaseInstance = InstanceType<typeof Database>

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', '..', '.data', 'review.db')

let db: DatabaseInstance | null = null

function ensureDir(filePath: string): void {
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

export function getDb(): DatabaseInstance {
  if (db) return db

  ensureDir(DB_PATH)
  db = new Database(DB_PATH)

  // 性能优化
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')

  return db
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
  }
}
