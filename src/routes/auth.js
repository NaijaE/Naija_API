import { Router } from 'express'
import { z } from 'zod'
import bcrypt from 'bcryptjs'
import { byIp, byEmail, byUser, MIN } from '../middleware/limits.js'
import { User, publicUser } from '../models/User.js'
import { audit } from '../models/AuditLog.js'
import { ah } from '../utils/asyncHandler.js'
import { httpError } from '../utils/httpError.js'
import { validate } from '../middleware/validate.js'
import { requireAuth, signToken } from '../middleware/auth.js'
import { sixDigits, hashCode, codeMatches, referralCode, normalizePhone } from '../utils/codes.js'
import { sendEmail, sendSms } from '../services/notify.js'
import { config } from '../config.js'

const r = Router()
// Per-route limits. Failed attempts count; successful logins do not.
const registerLimit = [byIp(60 * MIN, 40)]
const loginLimit = [byEmail(15 * MIN, 10, { skipSuccessfulRequests: true }), byIp(15 * MIN, 150, { skipSuccessfulRequests: true })]
const verifyLimit = [byUser(15 * MIN, 12)]
const resendLimit = [byUser(60 * MIN, 5), byIp(60 * MIN, 100)]
const forgotLimit = [byEmail(60 * MIN, 5), byIp(60 * MIN, 100)]
const resetLimit = [byEmail(60 * MIN, 10), byIp(60 * MIN, 100)]
const changePwLimit = [byUser(60 * MIN, 10)]
const CODE_TTL = 15 * 60 * 1000
const MAX_ATTEMPTS = 5

async function issueContactCodes(user) {
  const emailCode = sixDigits(); const phoneCode = sixDigits()
  user.emailCodeHash = hashCode(emailCode); user.phoneCodeHash = hashCode(phoneCode)
  user.codeExpires = new Date(Date.now() + CODE_TTL); user.codeAttempts = 0
  await user.save()
  await Promise.all([
    sendEmail(user.email, 'Your Naija Earn verification code', `Your email code is ${emailCode}. It expires in 15 minutes.`),
    sendSms(user.phone, `Naija Earn code: ${phoneCode}. Expires in 15 minutes.`),
  ])
  return config.exposeDevCodes ? { emailCode, phoneCode } : undefined
}

const registerSchema = z.object({
  name: z.string().trim().min(3).max(80),
  phone: z.string(),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(72),
  referralCode: z.string().trim().toUpperCase().max(12).optional(),
  consent: z.literal(true, { errorMap: () => ({ message: 'You must accept the terms.' }) }),
})
r.post('/register', ...registerLimit, validate(registerSchema), ah(async (req, res) => {
  const b = req.body
  const phone = normalizePhone(b.phone)
  if (!phone) throw httpError(400, 'Enter a valid Nigerian phone number.')
  if (await User.exists({ $or: [{ email: b.email }, { phone }] })) throw httpError(409, 'An account with that email or phone already exists.')
  let referredBy
  if (b.referralCode) {
    const ref = await User.findOne({ referralCode: b.referralCode, status: 'ACTIVE' }).select('_id')
    if (!ref) throw httpError(400, 'That referral code does not exist.')
    referredBy = ref._id
  }
  const passwordHash = await bcrypt.hash(b.password, 12)
  let user
  for (let i = 0; i < 5 && !user; i++) {
    try { user = await User.create({ name: b.name, phone, email: b.email, passwordHash, referralCode: referralCode(), referredBy, consentAt: new Date() }) }
    catch (e) { if (e.code === 11000 && e.keyPattern && e.keyPattern.referralCode) continue; throw e }
  }
  if (!user) throw httpError(500, 'Could not create the account. Try again.')
  const devCodes = await issueContactCodes(user)
  res.status(201).json({ token: signToken(user), user: publicUser(user), ...(devCodes ? { devCodes } : {}) })
}))

r.post('/login', ...loginLimit, validate(z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(72) })), ah(async (req, res) => {
  const user = await User.findOne({ email: req.body.email }).select('+passwordHash')
  const ok = user && (await bcrypt.compare(req.body.password, user.passwordHash))
  if (!ok) throw httpError(401, 'Incorrect email or password.')
  if (user.status !== 'ACTIVE') throw httpError(403, 'This account is suspended. Contact support.')
  res.json({ token: signToken(user), user: publicUser(user) })
}))

r.post('/verify', requireAuth, ...verifyLimit, validate(z.object({ emailCode: z.string().optional(), phoneCode: z.string().optional() })), ah(async (req, res) => {
  const u = await User.findById(req.user._id).select('+emailCodeHash +phoneCodeHash')
  if (u.emailVerified && u.phoneVerified) return res.json({ user: publicUser(u) })
  if (!u.codeExpires || u.codeExpires < new Date()) throw httpError(400, 'Codes expired. Request new codes.')
  if (u.codeAttempts >= MAX_ATTEMPTS) throw httpError(429, 'Too many wrong attempts. Request new codes.')
  const bad = (!u.emailVerified && !codeMatches(req.body.emailCode || '', u.emailCodeHash)) ? 'email' : (!u.phoneVerified && !codeMatches(req.body.phoneCode || '', u.phoneCodeHash)) ? 'phone' : null
  if (bad) { u.codeAttempts += 1; await u.save(); throw httpError(400, `The ${bad} code is incorrect.`) }
  u.emailVerified = true; u.phoneVerified = true; u.emailCodeHash = undefined; u.phoneCodeHash = undefined
  await u.save()
  res.json({ user: publicUser(u) })
}))

r.post('/resend', requireAuth, ...resendLimit, ah(async (req, res) => {
  const u = await User.findById(req.user._id)
  if (u.emailVerified && u.phoneVerified) throw httpError(400, 'Already verified.')
  const devCodes = await issueContactCodes(u)
  res.json({ ok: true, ...(devCodes ? { devCodes } : {}) })
}))

r.post('/forgot', ...forgotLimit, validate(z.object({ email: z.string().trim().toLowerCase().email() })), ah(async (req, res) => {
  const u = await User.findOne({ email: req.body.email })
  let devCode
  if (u && u.status === 'ACTIVE') {
    const code = sixDigits()
    u.resetCodeHash = hashCode(code); u.resetExpires = new Date(Date.now() + CODE_TTL); u.resetAttempts = 0
    await u.save()
    await sendEmail(u.email, 'Reset your Naija Earn password', `Your reset code is ${code}. It expires in 15 minutes. If you did not ask for this, ignore this email.`)
    if (config.exposeDevCodes) devCode = code
  }
  res.json({ ok: true, message: 'If that account exists, a reset code has been sent.', ...(devCode ? { devCode } : {}) })
}))

r.post('/reset', ...resetLimit, validate(z.object({ email: z.string().trim().toLowerCase().email(), code: z.string(), password: z.string().min(8).max(72) })), ah(async (req, res) => {
  const u = await User.findOne({ email: req.body.email }).select('+resetCodeHash')
  const fail = () => httpError(400, 'That code is invalid or has expired.')
  if (!u || !u.resetExpires || u.resetExpires < new Date() || u.resetAttempts >= MAX_ATTEMPTS) throw fail()
  if (!codeMatches(req.body.code, u.resetCodeHash)) { u.resetAttempts += 1; await u.save(); throw fail() }
  u.passwordHash = await bcrypt.hash(req.body.password, 12)
  u.resetCodeHash = undefined; u.resetExpires = undefined
  u.tokenVersion += 1 // signs out every existing session
  await u.save()
  await audit(u.email, 'PASSWORD_RESET', '')
  res.json({ ok: true })
}))

r.post('/change-password', requireAuth, ...changePwLimit, validate(z.object({ currentPassword: z.string().min(1).max(72), newPassword: z.string().min(8).max(72) })), ah(async (req, res) => {
  const u = await User.findById(req.user._id).select('+passwordHash')
  // 400 (not 401): a wrong current password must not look like an expired session to the app.
  if (!(await bcrypt.compare(req.body.currentPassword, u.passwordHash))) throw httpError(400, 'Your current password is incorrect.')
  if (req.body.currentPassword === req.body.newPassword) throw httpError(400, 'Choose a password that is different from your current one.')
  if (u.role === 'ADMIN' && req.body.newPassword.length < 10) throw httpError(400, 'Admin passwords must be at least 10 characters.')
  u.passwordHash = await bcrypt.hash(req.body.newPassword, 12)
  u.tokenVersion += 1 // signs out every other device
  await u.save()
  await audit(u.email, 'PASSWORD_CHANGED', '')
  await sendEmail(u.email, 'Your Naija Earn password was changed', 'Your password was just changed. If this was not you, reset your password straight away and contact support.')
  res.json({ ok: true, token: signToken(u) })
}))

export default r
