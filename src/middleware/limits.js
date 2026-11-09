import rateLimit from 'express-rate-limit'

// Several people on one mobile network can share an IP address, so most limits here are keyed by
// the ACCOUNT (email or user id) and only fall back to the IP. IP limits are generous broad-abuse guards.
const MESSAGE = { error: 'Too many attempts. Please wait a few minutes and try again.' }
const make = (windowMs, limit, keyGenerator, extra = {}) =>
  rateLimit({ windowMs, limit, keyGenerator, standardHeaders: true, legacyHeaders: false, message: MESSAGE, ...extra })

const emailOf = (req) => String((req.body && req.body.email) || '').trim().toLowerCase()

export const MIN = 60 * 1000
export const byIp = (windowMs, limit, extra) => make(windowMs, limit, (req) => req.ip, extra)
export const byEmail = (windowMs, limit, extra) => make(windowMs, limit, (req) => emailOf(req) || req.ip, extra)
export const byUser = (windowMs, limit, extra) => make(windowMs, limit, (req) => (req.user ? String(req.user._id) : req.ip), extra)
