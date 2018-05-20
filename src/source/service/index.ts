import {getConfig} from '../../config'

export const serviceMap = {
  go: ['gocode'],
  python: ['jedi'],
  javascript: ['tern']
}

export const supportedTypes = Object.keys(serviceMap)
