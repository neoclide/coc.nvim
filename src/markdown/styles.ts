'use strict'
import { styles } from '../util/node'

export function gray(str: string): string {
  return `${styles.gray.open}${str}${styles.gray.close}`
}

export function magenta(str: string): string {
  return `${styles.magenta.open}${str}${styles.magenta.close}`
}

export function bold(str: string): string {
  return `${styles.bold.open}${str}${styles.bold.close}`
}

export function underline(str: string): string {
  return `${styles.underline.open}${str}${styles.underline.close}`
}

export function strikethrough(str: string): string {
  return `${styles.strikethrough.open}${str}${styles.strikethrough.close}`
}

export function italic(str: string): string {
  return `${styles.italic.open}${str}${styles.italic.close}`
}

export function yellow(str: string): string {
  return `${styles.yellow.open}${str}${styles.yellow.close}`
}

export function green(str: string): string {
  return `${styles.green.open}${str}${styles.green.close}`
}

export function blue(str: string): string {
  return `${styles.blue.open}${str}${styles.blue.close}`
}
