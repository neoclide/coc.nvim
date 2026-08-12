import { version } from '../../package.json'
import { defaultValue } from './index'
import { fs, os, path } from './node'

function resolveDataHome(): string {
  if (process.env.XDG_CONFIG_HOME) {
    try {
      if (fs.statSync(process.env.XDG_CONFIG_HOME).isDirectory()) {
        return path.join(process.env.XDG_CONFIG_HOME, 'coc')
      }
    } catch (_e) {
      // fall through to the default
    }
  }
  return path.join(os.homedir(), '.config', 'coc')
}

export const ASCII_END = 128
export const VERSION = version
export const isVim = process.env.VIM_NODE_RPC == '1'
export const APIVERSION = 38
export const floatHighlightGroup = 'CocFloating'
export const CONFIG_FILE_NAME = 'coc-settings.json'
export const configHome = defaultValue<string>(process.env.COC_VIMCONFIG, path.join(os.homedir(), '.vim'))
export const dataHome = defaultValue<string>(process.env.COC_DATA_HOME, resolveDataHome())
export const userConfigFile = path.join(path.normalize(configHome), CONFIG_FILE_NAME)
// Under the test bundle every module's __dirname points at the in-memory
// bundle, so the runner sets COC_TEST_ROOT to the repository root (bin/,
// data/ and package.json resolve from the source tree) and we use it
// directly.
export const pluginRoot = process.env.COC_TEST_ROOT
  ? process.env.COC_TEST_ROOT
  : __filename.endsWith('index.js') ? path.dirname(__dirname) : path.resolve(__dirname, '../..')
