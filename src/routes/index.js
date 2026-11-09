import { Router } from 'express'
import pub from './public.js'
import auth from './auth.js'
import me from './me.js'
import videos from './videos.js'
import orders from './orders.js'
import withdrawals from './withdrawals.js'
import uploads from './uploads.js'
import advertiser from './advertiser.js'
import admin from './admin.js'

const r = Router()
r.use('/public', pub)
r.use('/auth', auth)
r.use('/me', me)
r.use('/videos', videos)
r.use('/orders', orders)
r.use('/withdrawals', withdrawals)
r.use('/uploads', uploads)
r.use('/advertiser', advertiser)
r.use('/admin', admin)
export default r
