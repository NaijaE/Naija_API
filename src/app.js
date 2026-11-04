import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import morgan from 'morgan'
import rateLimit from 'express-rate-limit'
import { config } from './config.js'
import { httpError } from './utils/httpError.js'
import { errorHandler, notFound } from './middleware/error.js'
import webhooks from './routes/webhooks.js'
import api from './routes/index.js'

export function createApp() {
  const app = express()
  app.set('trust proxy', 1) // Render sits behind a proxy
  app.use(helmet())
  app.use(cors({
    origin: (origin, cb) => (!origin || config.clientOrigins.includes(origin) ? cb(null, true) : cb(httpError(403, 'Origin not allowed'))),
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 600,
  }))
  if (!config.isProd) app.use(morgan('dev'))
  else app.use(morgan('combined'))

  app.get('/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }))

  // Webhooks need the RAW body to verify signatures, so they are mounted before express.json()
  app.use('/api/webhooks', express.raw({ type: '*/*', limit: '1mb' }), webhooks)

  app.use(express.json({ limit: '100kb' }))
  app.use('/api', rateLimit({ windowMs: 15 * 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false }))
  app.use('/api', api)

  app.use(notFound)
  app.use(errorHandler)
  return app
}
