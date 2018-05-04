import * as winston from 'winston'
import os = require('os')
import path = require('path')

const transports = []
const level = process.env.NVIM_COMPLETE_LOG_LEVEL || 'info'
const file = process.env.NVIM_COMPLETE_LOG_FILE || path.join(os.tmpdir(), 'nvim-complete.log')

transports.push(
  new winston.transports.File({
    filename: file,
    level,
    json: false,
  })
)

// transports.push(winston.transports.Console)

const logger: winston.LoggerInstance = new winston.Logger({
  level,
  transports,
})

export type ILogger = winston.LoggerInstance
export { logger }
