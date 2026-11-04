import jwt from 'jsonwebtoken'
import { config } from '../config.js'
import { User } from '../models/User.js'
import { httpError } from '../utils/httpError.js'
import { ah } from '../utils/asyncHandler.js'

export const signToken = (user) => jwt.sign({ sub: String(user._id), tv: user.tokenVersion }, config.jwtSecret, { expiresIn: config.jwtExpires })

export const requireAuth = ah(async (req, _res, next) => {
  const h = req.headers.authorization || ''
  const token = h.startsWith('Bearer ') ? h.slice(7) : null
  if (!token) throw httpError(401, 'Please log in.')
  let payload
  try { payload = jwt.verify(token, config.jwtSecret) } catch { throw httpError(401, 'Session expired. Please log in again.') }
  const user = await User.findById(payload.sub)
  if (!user || user.status !== 'ACTIVE' || user.tokenVersion !== payload.tv) throw httpError(401, 'Please log in again.')
  req.user = user
  next()
})
export const requireVerified = (req, _res, next) =>
  (req.user.emailVerified && req.user.phoneVerified ? next() : next(httpError(403, 'Verify your email and phone first.')))
export const requireMember = (req, _res, next) => (req.user.role === 'MEMBER' ? next() : next(httpError(403, 'Members only.')))
export const requireAdmin = (req, _res, next) => (req.user.role === 'ADMIN' ? next() : next(httpError(403, 'Admins only.')))
