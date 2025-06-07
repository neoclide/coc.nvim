import type STYLES from 'ansi-styles'
import type CHILD_PROCESS from 'child_process'
import type CRYPTO from 'crypto'
import type DEBOUNCE from 'debounce'
import type FASTDIFF from 'fast-diff'
import type FS from 'fs'
import type * as GLOB from 'glob'
import type * as Minimatch from 'minimatch'
import type NET from 'net'
import type OS from 'os'
import type PATH from 'path'
import type READLINE from 'readline'
import type SEMVER from 'semver'
import type STRIPANSI from 'strip-ansi'
import type UNIDECODE from 'unidecode'
import { inspect, promisify } from 'util'
import type VM from 'vm'
import type WHICH from 'which'

export const fs = require('fs') as typeof FS
export const path = require('path') as typeof PATH
export const os = require('os') as typeof OS
export const crypto = require('crypto') as typeof CRYPTO
export const styles = require('ansi-styles') as typeof STYLES
export const debounce = require('debounce') as typeof DEBOUNCE
export const readline = require('readline') as typeof READLINE
export const child_process = require('child_process') as typeof CHILD_PROCESS
export const glob = require('glob') as typeof GLOB
export const { minimatch } = require('minimatch') as typeof Minimatch
export const which = require('which') as typeof WHICH
export const semver = require('semver') as typeof SEMVER
export const vm = require('vm') as typeof VM
export const net = require('net') as typeof NET
export const stripAnsi = require('strip-ansi') as typeof STRIPANSI
export const fastDiff = require('fast-diff') as typeof FASTDIFF
export const unidecode = require('unidecode') as typeof UNIDECODE
export { inspect, promisify }

