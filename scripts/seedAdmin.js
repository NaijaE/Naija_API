// Usage: node scripts/seedAdmin.js admin@example.com 'StrongPassword' "Admin Name"
// Run it twice with two different emails: settings changes need a second admin to approve.
import dns from 'node:dns'
dns.setServers(['8.8.8.8', '1.1.1.1'])
import bcrypt from 'bcryptjs'
import mongoose from 'mongoose'
import { config } from '../src/config.js'
import { User } from '../src/models/User.js'
import { referralCode } from '../src/utils/codes.js'

const [email, password, name = 'Admin'] = process.argv.slice(2)
if (!email || !password || password.length < 10) {
  console.error("Usage: node scripts/seedAdmin.js <email> <password (10+ chars)> [name]")
  process.exit(1)
}
await mongoose.connect(config.mongoUri)
const existing = await User.findOne({ email: email.toLowerCase() })
if (existing) { console.log('That email already exists.'); await mongoose.disconnect(); process.exit(0) }
await User.create({
  name, email: email.toLowerCase(), phone: `+23480${String(Date.now()).slice(-8)}`, passwordHash: await bcrypt.hash(password, 12),
  role: 'ADMIN', emailVerified: true, phoneVerified: true, referralCode: referralCode(), consentAt: new Date(),
})
console.log(`Admin created: ${email}`)
await mongoose.disconnect()
