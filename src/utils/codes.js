import crypto from 'crypto'
import { config } from '../config.js'

export const sixDigits = () => String(crypto.randomInt(100000, 1000000))
export const hashCode = (code) => crypto.createHash('sha256').update(`${code}:${config.jwtSecret}`).digest('hex')
export function codeMatches(code, hash) {
  if (!hash) return false
  const a = Buffer.from(hashCode(String(code).trim()))
  const b = Buffer.from(hash)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const referralCode = () => 'NE' + Array.from({ length: 6 }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('')
export function normalizePhone(p) {
  const d = String(p).replace(/[\s-]/g, '')
  if (/^0[789][01]\d{8}$/.test(d)) return '+234' + d.slice(1)
  if (/^\+234[789][01]\d{8}$/.test(d)) return d
  if (/^234[789][01]\d{8}$/.test(d)) return '+' + d
  return null
}
