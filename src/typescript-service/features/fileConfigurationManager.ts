import workspace from '../../workspace'
import {
  FormatOptions
} from '../../types'
import * as Proto from '../protocol'
import {ITypeScriptServiceClient} from '../typescriptService'

interface FileConfiguration {
  formatOptions: Proto.FormatCodeSettings
  preferences: Proto.UserPreferences
}

export interface CompletionOptions {
  readonly useCodeSnippetsOnMethodSuggest: boolean
  readonly nameSuggestions: boolean
  readonly autoImportSuggestions: boolean
}

export default class FileConfigurationManager {
  public constructor(private readonly client: ITypeScriptServiceClient) {
  }

  public async ensureConfigurationOptions (): Promise<void> {
    let options = await workspace.getFormatOptions()
    const currentOptions = this.getFileOptions(options)

    const args = {
      hostInfo: 'Neovim coc',
      ...currentOptions
    } as Proto.ConfigureRequestArguments
    await this.client.execute('configure', args)
  }

  private getFileOptions(options: FormatOptions): FileConfiguration {
    return {
      formatOptions: this.getFormatOptions(options),
      preferences: this.getPreferences()
    }
  }

  private getFormatOptions( options: FormatOptions): Proto.FormatCodeSettings {
    const config = workspace.getConfiguration('typescript.format')

    return {
      tabSize: options.tabSize,
      indentSize: options.tabSize,
      convertTabsToSpaces: options.insertSpaces,
      // We can use \n here since the editor normalizes later on to its line endings.
      newLineCharacter: '\n',
      insertSpaceAfterCommaDelimiter: config.get<boolean>(
        'insertSpaceAfterCommaDelimiter'
      ),
      insertSpaceAfterConstructor: config.get<boolean>(
        'insertSpaceAfterConstructor'
      ),
      insertSpaceAfterSemicolonInForStatements: config.get<boolean>(
        'insertSpaceAfterSemicolonInForStatements'
      ),
      insertSpaceBeforeAndAfterBinaryOperators: config.get<boolean>(
        'insertSpaceBeforeAndAfterBinaryOperators'
      ),
      insertSpaceAfterKeywordsInControlFlowStatements: config.get<boolean>(
        'insertSpaceAfterKeywordsInControlFlowStatements'
      ),
      insertSpaceAfterFunctionKeywordForAnonymousFunctions: config.get<boolean>(
        'insertSpaceAfterFunctionKeywordForAnonymousFunctions'
      ),
      insertSpaceBeforeFunctionParenthesis: config.get<boolean>(
        'insertSpaceBeforeFunctionParenthesis'
      ),
      insertSpaceAfterOpeningAndBeforeClosingNonemptyParenthesis: config.get<
        boolean
      >('insertSpaceAfterOpeningAndBeforeClosingNonemptyParenthesis'),
      insertSpaceAfterOpeningAndBeforeClosingNonemptyBrackets: config.get<
        boolean
      >('insertSpaceAfterOpeningAndBeforeClosingNonemptyBrackets'),
      insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces: config.get<
        boolean
      >('insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces'),
      insertSpaceAfterOpeningAndBeforeClosingTemplateStringBraces: config.get<
        boolean
      >('insertSpaceAfterOpeningAndBeforeClosingTemplateStringBraces'),
      insertSpaceAfterOpeningAndBeforeClosingJsxExpressionBraces: config.get<
        boolean
      >('insertSpaceAfterOpeningAndBeforeClosingJsxExpressionBraces'),
      insertSpaceAfterTypeAssertion: config.get<boolean>(
        'insertSpaceAfterTypeAssertion'
      ),
      placeOpenBraceOnNewLineForFunctions: config.get<boolean>(
        'placeOpenBraceOnNewLineForFunctions'
      ),
      placeOpenBraceOnNewLineForControlBlocks: config.get<boolean>(
        'placeOpenBraceOnNewLineForControlBlocks'
      )
    }
  }

  public getCompleteOptions():CompletionOptions {
    const config = workspace.getConfiguration('typescript.preferences.completion')
    return {
      useCodeSnippetsOnMethodSuggest: config.get<boolean>('useCodeSnippetsOnMethodSuggest'),
      nameSuggestions: config.get<boolean>('nameSuggestions'),
      autoImportSuggestions: config.get<boolean>('autoImportSuggestions')
    }
  }

  public getPreferences(): Proto.UserPreferences {
    if (!this.client.apiVersion.has290Features()) {
      return {}
    }
    const config = workspace.getConfiguration('typescript.preferences')
    return {
      importModuleSpecifierPreference: getImportModuleSpecifier(config) as any,
      disableSuggestions: !config.get<boolean>('suggestionActions.enabled'),
      quotePreference: getQuoteType(config)
    }
  }
}

type ModuleImportType = 'relative' | 'non-relative' | 'auto'
type QuoteType = 'single' | 'double'

function getImportModuleSpecifier(config):ModuleImportType {
  let val = config.get('importModuleSpecifier')
  switch (val) {
    case 'relative':
      return 'relative'
    case 'non-relative':
      return 'non-relative'
    default:
      return 'auto'
  }
}

function getQuoteType(config):QuoteType {
  let val = config.get('quoteStyle')
  switch (val) {
    case 'single':
      return 'single'
    case 'double':
      return 'double'
    default:
      return 'single'
  }
}
