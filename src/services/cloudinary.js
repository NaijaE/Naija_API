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

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// Cloudinary reports length in different places depending on the file; accept a number, "12.5" or "00:00:12".
function toSeconds(v) {
  if (v == null) return 0
  if (typeof v === 'string' && v.includes(':')) return v.split(':').reduce((a, p) => a * 60 + (parseFloat(p) || 0), 0)
  return Number(v) || 0
}

// We never trust a client-supplied URL or duration: read both from Cloudinary using the public id.
export async function inspectVideo(publicId) {
  ready()
  if (!VIDEO_ID_RE.test(publicId)) throw httpError(400, 'Invalid video reference.')
  let info, seconds = 0
  for (let attempt = 1; attempt <= 3 && !seconds; attempt++) {
    try { info = await cloudinary.api.resource(publicId, { resource_type: 'video', media_metadata: true }) }
    catch (e) {
      const why = (e && e.error && e.error.message) || (e && e.message) || 'unknown'
      console.error(`Cloudinary lookup failed for ${publicId}: ${why}`)
      throw httpError(400, `Video not found. Upload it first.${config.isProd ? '' : ` (${why})`}`)
    }
    const meta = info.video_metadata || {}
    seconds = toSeconds(info.duration) || toSeconds(info.video && info.video.duration) || toSeconds(meta.duration) || toSeconds(meta.Duration)
    if (!seconds && attempt < 3) await wait(1500)
  }
  if (!seconds) {
    console.error(`No duration for ${publicId}: ${JSON.stringify({ format: info.format, bytes: info.bytes, keys: Object.keys(info), video: info.video, metaKeys: Object.keys(info.video_metadata || {}) })}`)
    throw httpError(400, 'We could not read the length of this video. Try another file, or wait a moment and try again.')
  }
  const durationSec = Math.ceil(seconds)
  if (durationSec < 10 || durationSec > 120) throw httpError(400, `Your video is ${durationSec} seconds long. It must be between 10 and 120 seconds.`)

  // Serve every upload as MP4 (H.264/AAC) so it plays in all browsers, whatever format was uploaded.
  // Cloudinary prepares the converted copy in the background; the first view may take a moment.
  cloudinary.uploader.explicit(publicId, { resource_type: 'video', type: 'upload', eager: [{ format: 'mp4', video_codec: 'h264', audio_codec: 'aac' }], eager_async: true })
    .catch((e) => console.error(`Could not prepare MP4 for ${publicId}: ${(e && e.message) || e}`))
  const url = cloudinary.url(publicId, { resource_type: 'video', secure: true, format: 'mp4', transformation: [{ video_codec: 'h264', audio_codec: 'aac' }] })
  return { url, durationSec }
}

// Used by the admin diagnostics check: confirms the three Cloudinary values are accepted.
export async function pingCloudinary() { ready(); await cloudinary.api.ping() }

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