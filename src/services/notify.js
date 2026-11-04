import nodemailer from 'nodemailer'
import { config } from '../config.js'

const transport = config.smtp.host
  ? nodemailer.createTransport({ host: config.smtp.host, port: config.smtp.port, secure: config.smtp.port === 465, auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.pass } : undefined })
  : null

export async function sendEmail(to, subject, text) {
  try {
    if (!transport) { if (!config.isProd) console.log(`[email:dev] to=${to} subject="${subject}" ${text}`); return }
    await transport.sendMail({ from: config.smtp.from, to, subject, text })
  } catch (e) { console.error('Email failed:', e.message) }
}
export async function sendSms(to, text) {
  try {
    if (!config.termii.apiKey) { if (!config.isProd) console.log(`[sms:dev] to=${to} ${text}`); return }
    await fetch('https://api.ng.termii.com/api/sms/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(15000),
      body: JSON.stringify({ to: to.replace('+', ''), from: config.termii.senderId, sms: text, type: 'plain', channel: 'generic', api_key: config.termii.apiKey }),
    })
  } catch (e) { console.error('SMS failed:', e.message) }
}
