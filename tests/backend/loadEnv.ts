/**
 * Loads .env then .env.local (Next.js precedence: .env.local wins) into
 * process.env before any test module is imported.
 *
 * Deliberately dependency-free — dotenv is not in the project's dependency set
 * and these tests should not add one just to read two files.
 */
import fs from 'fs'
import path from 'path'

const root = path.resolve(__dirname, '..', '..')

function load(file: string) {
  const full = path.join(root, file)
  if (!fs.existsSync(full)) return
  for (const rawLine of fs.readFileSync(full, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) continue
    const value = match[2].trim().replace(/^["']|["']$/g, '')
    // Later files override earlier ones, matching Next.js behaviour.
    if (value !== '') process.env[match[1]] = value
  }
}

load('.env')
load('.env.local')
