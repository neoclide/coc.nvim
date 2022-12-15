import { version } from '../../package.json'
import { getConditionValue, defaultValue } from './index'
import { path, os } from './node'

export const ASCII_END = 128
export const VERSION = version
export const isVim = process.env.VIM_NODE_RPC == '1'
export const APIVERSION = 34
export const floatHighlightGroup = 'CocFloating'
export const CONFIG_FILE_NAME = 'coc-settings.json'
export const configHome = defaultValue<string>(process.env.COC_VIMCONFIG, path.join(os.homedir(), '.vim'))
export const dataHome = defaultValue<string>(process.env.COC_DATA_HOME, path.join(os.homedir(), '.config/coc'))
export const userConfigFile = path.join(path.normalize(configHome), CONFIG_FILE_NAME)
export const pluginRoot = getConditionValue(path.dirname(__dirname), path.resolve(__dirname, '../..'))
export const watchmanCommand = 'watchman'
