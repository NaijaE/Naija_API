import { ZodError } from 'zod'
import multer from 'multer'
import { HttpError } from '../utils/httpError.js'
import { config } from '../config.js'

export const notFound = (_req, res) => res.status(404).json({ error: 'Not found' })

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, details: err.details })
  if (err instanceof ZodError) return res.status(400).json({ error: 'Invalid input', details: err.flatten() })
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.message })
  if (err && err.code === 11000) return res.status(409).json({ error: 'That value is already in use.' })
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON' })
  console.error(err)
  res.status(500).json({ error: 'Something went wrong.', ...(config.isProd ? {} : { debug: String(err && err.message) }) })
}
