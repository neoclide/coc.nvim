import {getConfig} from '../../config'

export const serviceMap = {
  python: ['jedi'],
  javascript: ['tern']
}

export const supportedTypes = Object.keys(serviceMap)
