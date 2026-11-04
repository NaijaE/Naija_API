import { Router } from 'express'
import { requireAuth, requireVerified, requireMember } from '../middleware/auth.js'
import { videoUploadSignature } from '../services/cloudinary.js'

const r = Router()
// Step 1 of buying a package: get a signed upload for the sponsor video, upload it to Cloudinary from the browser,
// then send the returned public_id when you create the order.
r.post('/video-signature', requireAuth, requireVerified, requireMember, (_req, res) => res.json(videoUploadSignature()))
export default r
