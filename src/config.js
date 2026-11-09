import 'dotenv/config'

const need = (k) => {
  if (!process.env[k]) throw new Error(`Missing required environment variable: ${k}`)
  return process.env[k]
}
const env = process.env.NODE_ENV || 'development'

export const config = {
  env,
  isProd: env === 'production',
  port: Number(process.env.PORT) || 4000,
  mongoUri: need('MONGODB_URI'),
  jwtSecret: need('JWT_SECRET'),
  jwtExpires: '7d',
  clientOrigins: (process.env.CLIENT_ORIGINS || 'http://localhost:5173').split(',').map((s) => s.trim()).filter(Boolean),
  paymentReturnUrl: process.env.PAYMENT_RETURN_URL || 'http://localhost:5173/#/app/advertise',
  exposeDevCodes: env !== 'production' && process.env.EXPOSE_DEV_CODES === 'true',
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  },
  paystackSecret: process.env.PAYSTACK_SECRET_KEY,
  flutterwave: { secret: process.env.FLUTTERWAVE_SECRET_KEY, hash: process.env.FLUTTERWAVE_SECRET_HASH },
  brevoApiKey: process.env.BREVO_API_KEY,
  reconcileEnabled: process.env.RECONCILE_ENABLED !== 'false',
  smtp: { host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT) || 587, user: process.env.SMTP_USER, pass: process.env.SMTP_PASS, from: process.env.MAIL_FROM || 'Naija Earn <no-reply@localhost>' },
  termii: { apiKey: process.env.TERMII_API_KEY, senderId: process.env.TERMII_SENDER_ID || 'NaijaEarn', channel: process.env.TERMII_CHANNEL || 'dnd' },
  bank: {
    bank: process.env.BANK_NAME || 'Demo Bank',
    accountName: process.env.BANK_ACCOUNT_NAME || 'Naija Earn Ltd',
    accountNumber: process.env.BANK_ACCOUNT_NUMBER || '0000000000',
  },
}
