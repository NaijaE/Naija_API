import mongoose from 'mongoose'
const { Schema } = mongoose

const auditSchema = new Schema({ actor: String, action: { type: String, index: true }, detail: String }, { timestamps: true })
export const AuditLog = mongoose.model('AuditLog', auditSchema)
export const audit = (actor, action, detail = '', session) => AuditLog.create([{ actor, action, detail }], session ? { session } : undefined)
