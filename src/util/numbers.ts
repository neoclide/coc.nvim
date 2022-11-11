'use strict'
import * as Is from './is'

export function toNumber(n: number | undefined | null, defaultValue = 0): number {
  return Is.number(n) ? n : defaultValue
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function rot(index: number, modulo: number): number {
  return (modulo + (index % modulo)) % modulo
}
