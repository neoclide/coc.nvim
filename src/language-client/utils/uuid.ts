import uuidv4 = require('uuid/v4')

export function generateUuid(): string {
  return uuidv4()
}
