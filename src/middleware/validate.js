import { httpError } from '../utils/httpError.js'

export const validate = (schema, where = 'body') => (req, _res, next) => {
  const r = schema.safeParse(req[where])
  if (!r.success) return next(httpError(400, 'Invalid input', r.error.flatten()))
  req[where] = r.data
  next()
}
