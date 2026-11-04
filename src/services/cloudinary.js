import { v2 as cloudinary } from 'cloudinary'
import { config } from '../config.js'
import { httpError } from '../utils/httpError.js'

const c = config.cloudinary
cloudinary.config({ cloud_name: c.cloudName, api_key: c.apiKey, api_secret: c.apiSecret, secure: true })
const ready = () => { if (!c.cloudName || !c.apiKey || !c.apiSecret) throw httpError(503, 'File storage is not configured.') }

export const VIDEO_FOLDER = 'naija/videos'
export const VIDEO_ID_RE = /^naija\/videos\/[A-Za-z0-9_-]+$/

// The browser uploads video straight to Cloudinary with this signature (keeps big files off our server).
export function videoUploadSignature() {
  ready()
  const timestamp = Math.round(Date.now() / 1000)
  const params = { timestamp, folder: VIDEO_FOLDER }
  const signature = cloudinary.utils.api_sign_request(params, c.apiSecret)
  return { cloudName: c.cloudName, apiKey: c.apiKey, timestamp, folder: VIDEO_FOLDER, signature, resourceType: 'video',
    uploadUrl: `https://api.cloudinary.com/v1_1/${c.cloudName}/video/upload` }
}

// We never trust a client-supplied URL or duration: read both from Cloudinary using the public id.
export async function inspectVideo(publicId) {
  ready()
  if (!VIDEO_ID_RE.test(publicId)) throw httpError(400, 'Invalid video reference.')
  let info
  try { info = await cloudinary.api.resource(publicId, { resource_type: 'video' }) } catch { throw httpError(400, 'Video not found. Upload it first.') }
  return { url: cloudinary.url(publicId, { resource_type: 'video', secure: true }), durationSec: Math.ceil(info.duration || 0) }
}

export function uploadProof(buffer, name) {
  ready()
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream({ folder: 'naija/proofs', resource_type: 'auto', type: 'authenticated' }, (err, r) => {
      if (err) return reject(httpError(502, 'Could not store your proof of payment. Try again.'))
      resolve({ publicId: r.public_id, resourceType: r.resource_type, format: r.format, name })
    })
    stream.end(buffer)
  })
}

// Proofs are private ("authenticated"): admins get a signed link.
export function proofLink(p) {
  if (!p || !p.publicId) return null
  return cloudinary.url(p.publicId, { resource_type: p.resourceType || 'image', type: 'authenticated', sign_url: true, secure: true, format: p.format })
}
