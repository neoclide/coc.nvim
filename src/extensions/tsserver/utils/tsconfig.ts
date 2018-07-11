/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as Proto from '../protocol'
import {TypeScriptServiceConfiguration} from './configuration'
const logger = require('../../../util/logger')('tsserver-tsconfig')

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
