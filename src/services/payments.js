import { config } from '../config.js'
import { httpError } from '../utils/httpError.js'

// The provider's own reason is always written to the server log. Outside production it is also returned,
// so a test or staging problem is easy to read. In production only a generic message reaches the browser.
const call = async (url, opts, label) => {
  let res
  try { res = await fetch(url, { ...opts, signal: AbortSignal.timeout(20000) }) }
  catch (e) { console.error(`${label} unreachable:`, e.message); throw httpError(502, `${label} is unreachable. Try again.`) }
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail = (json && (json.message || json.error)) || ''
    console.error(`${label} rejected the request (HTTP ${res.status}): ${detail}`)
    throw httpError(502, `${label} rejected the request.${config.isProd ? '' : ` (${res.status}: ${detail})`}`)
  }
  return json
}

// ---- Paystack (amounts in kobo) ----
export async function initPaystack({ email, amountKobo, reference, callbackUrl }) {
  if (!config.paystackSecret) throw httpError(503, 'Paystack is not configured.')
  const j = await call('https://api.paystack.co/transaction/initialize', {
    method: 'POST', headers: { Authorization: `Bearer ${config.paystackSecret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, amount: amountKobo, reference, callback_url: callbackUrl, currency: 'NGN' }),
  }, 'Paystack')
  if (!j.data || !j.data.authorization_url) throw httpError(502, 'Paystack did not return a payment link.')
  return { paymentUrl: j.data.authorization_url }
}
export async function verifyPaystack(reference) {
  const j = await call(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${config.paystackSecret}` } }, 'Paystack')
  const d = j.data || {}
  return { paid: d.status === 'success' && d.currency === 'NGN', amountKobo: d.amount, ref: String(d.reference || reference) }
}

// ---- Flutterwave (amounts in naira) ----
export async function initFlutterwave({ email, name, phone, amountKobo, reference, callbackUrl }) {
  if (!config.flutterwave.secret) throw httpError(503, 'Flutterwave is not configured.')
  const j = await call('https://api.flutterwave.com/v3/payments', {
    method: 'POST', headers: { Authorization: `Bearer ${config.flutterwave.secret}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ tx_ref: reference, amount: amountKobo / 100, currency: 'NGN', redirect_url: callbackUrl,
      customer: { email, name, phonenumber: phone }, customizations: { title: 'Naija Earn advert package' } }),
  }, 'Flutterwave')
  return { paymentUrl: j.data.link }
}
export async function verifyFlutterwave(reference) {
  const j = await call(`https://api.flutterwave.com/v3/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${config.flutterwave.secret}` } }, 'Flutterwave')
  const d = j.data || {}
  return { paid: d.status === 'successful' && d.currency === 'NGN', amountKobo: Math.round(Number(d.amount) * 100), ref: String(d.flw_ref || d.tx_ref || reference) }
}
