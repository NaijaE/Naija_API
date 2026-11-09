import nodemailer from 'nodemailer'
import { config } from '../config.js'

// Email: Brevo's HTTPS API when BREVO_API_KEY is set (works even where outbound SMTP ports are blocked),
// otherwise SMTP, otherwise (development only) it just logs. Every sender returns { ok, error? } and never throws.
const smtp = config.smtp.host
  ? nodemailer.createTransport({ host: config.smtp.host, port: config.smtp.port, secure: config.smtp.port === 465, auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined })
  : null

export const emailConfigured = () => Boolean(config.brevoApiKey || smtp)
export const smsConfigured = () => Boolean(config.termii.apiKey)

function parseFrom(from) {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(from)
  return m ? { name: m[1].trim() || undefined, email: m[2].trim() } : { email: from.trim() }
}

export async function sendEmail(to, subject, text) {
  if (!emailConfigured()) {
    if (!config.isProd) console.log(`[email:dev] to=${to} subject="${subject}" ${text}`)
    return { ok: false, error: 'Email is not configured' }
  }
  try {
    if (config.brevoApiKey) {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST', signal: AbortSignal.timeout(15000),
        headers: { 'api-key': config.brevoApiKey, 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sender: parseFrom(config.smtp.from), to: [{ email: to }], subject, textContent: text }),
      })
      if (!res.ok) { const j = await res.json().catch(() => ({})); console.error('Email failed:', res.status, j.message || ''); return { ok: false, error: j.message || `HTTP ${res.status}` } }
      return { ok: true }
    }
    await smtp.sendMail({ from: config.smtp.from, to, subject, text })
    return { ok: true }
  } catch (e) { console.error('Email failed:', e.message); return { ok: false, error: e.message } }
}

export async function sendSms(to, text) {
  if (!smsConfigured()) {
    if (!config.isProd) console.log(`[sms:dev] to=${to} ${text}`)
    return { ok: false, error: 'SMS is not configured' }
  }
  try {
    // OTP and account messages must use Termii's "dnd" (transactional) route so they reach numbers on Do-Not-Disturb.
    const res = await fetch('https://api.ng.termii.com/api/sms/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ to: to.replace('+', ''), from: config.termii.senderId, sms: text, type: 'plain', channel: config.termii.channel, api_key: config.termii.apiKey }),
    })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) { console.error('SMS failed:', res.status, j.message || ''); return { ok: false, error: j.message || `HTTP ${res.status}` } }
    return { ok: true }
  } catch (e) { console.error('SMS failed:', e.message); return { ok: false, error: e.message } }
}
