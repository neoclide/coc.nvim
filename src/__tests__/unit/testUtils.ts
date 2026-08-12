import { equals } from '../../util/object'
import type { ProviderResult } from '../../provider'
import type { TreeNode } from '../../tree/BasicDataProvider'

export type NodeDef = [string, NodeDef[]?]

export interface CustomNode extends TreeNode {
  kind?: string
  x?: number
  y?: number
}

export function createNode(label: string, children?: TreeNode[], key?: string, tooltip?: string): CustomNode {
  let res: TreeNode = { label }
  if (children) res.children = children
  if (tooltip) res.tooltip = tooltip
  if (key) res.key = key
  return res
}

export function createNodes(defs: NodeDef[]): TreeNode[] {
  return defs.map(o => {
    let children
    if (Array.isArray(o[1])) {
      children = createNodes(o[1])
    }
    return createNode(o[0], children)
  })
}

export function makeLine(length): string {
  let result = ''
  let characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 (){};,\\<>+=`^*!@#$%[]:"/?'
  let charactersLength = characters.length
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength))
  }
  return result
}

export function wait(ms = 30): Promise<void> {
  return new Promise(resolve => {
    setTimeout(() => resolve(), ms)
  })
}

export async function waitValue<T>(fn: () => ProviderResult<T>, value: T): Promise<void> {
  let find = false
  for (let i = 0; i < 200; i++) {
    await wait(20)
    let res = await Promise.resolve(fn())
    if (equals(res, value)) {
      find = true
      break
    }
  }
  if (!find) {
    throw new Error(`waitValue ${value} timeout`)
  }
}
