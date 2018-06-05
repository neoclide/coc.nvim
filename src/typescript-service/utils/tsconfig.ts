import { TypeScriptServiceConfiguration } from './configuration'
import * as Proto from '../protocol'

export function inferredProjectConfig(
  config: TypeScriptServiceConfiguration
): Proto.ExternalProjectCompilerOptions {
  const base: Proto.ExternalProjectCompilerOptions = {
    module: 'commonjs' as Proto.ModuleKind,
    target: 'es2016' as Proto.ScriptTarget,
    jsx: 'preserve' as Proto.JsxEmit
  }

  if (config.checkJs) {
    base.checkJs = true
  }

  if (config.experimentalDecorators) {
    base.experimentalDecorators = true
  }

  return base
}
