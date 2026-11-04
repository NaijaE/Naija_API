import multer from 'multer'
import { httpError } from '../utils/httpError.js'

const ok = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
// Proof of payment is held in memory briefly, then streamed to Cloudinary. 5 MB cap.
export const proofUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => (ok.has(file.mimetype) ? cb(null, true) : cb(httpError(400, 'Proof must be a JPG, PNG, WEBP or PDF file.'))),
})
