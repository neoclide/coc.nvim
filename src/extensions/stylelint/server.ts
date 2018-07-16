import stylelintVSCode from 'stylelint-vscode'
import {createConnection, IConnection, TextDocument, TextDocuments} from 'vscode-languageserver'
import {formatError} from './runner'

const connection: IConnection = createConnection()
const documents = new TextDocuments()
console.log = connection.console.log.bind(connection.console)
console.error = connection.console.error.bind(connection.console)

process.on('unhandledRejection', (e: any) => {
  connection.console.error(formatError(`Unhandled exception`, e))
})

let config: any
let configOverrides: any

const pendingValidationRequests: {[uri: string]: NodeJS.Timer} = {}
const validationDelayMs = 200

function cleanPendingValidation(textDocument: TextDocument): void {
  const request = pendingValidationRequests[textDocument.uri]
  if (request) {
    clearTimeout(request)
    delete pendingValidationRequests[textDocument.uri]
  }
}

function triggerValidation(textDocument: TextDocument): void {
  cleanPendingValidation(textDocument)
  pendingValidationRequests[textDocument.uri] = setTimeout(() => {
    delete pendingValidationRequests[textDocument.uri]
    validateTextDocument(textDocument).catch(_e => {
      // noop
    })
  }, validationDelayMs)
}

async function validateTextDocument(document: TextDocument): Promise<void> {
  const options: any = {}
  if (config) options.config = config
  if (configOverrides) options.configOverrides = configOverrides

  try {
    let diagnostics = await stylelintVSCode(document, options)
    for (let item of diagnostics) {
      delete item.code
    }
    connection.sendDiagnostics({
      uri: document.uri,
      diagnostics
    })
  } catch (err) {
    if (err.reasons) {
      for (const reason of err.reasons) {
        connection.window.showErrorMessage(`stylelint: ${reason}`)
      }

      return
    }

    // https://github.com/stylelint/stylelint/blob/9.3.0/lib/utils/configurationError.js#L9
    if (err.code === 78) {
      connection.window.showErrorMessage(`stylelint: ${err.message}`)
      return
    }
    connection.window.showErrorMessage(err.stack.replace(/\n/g, ' '))
  }
}

function validateAll(): void {
  for (const document of documents.all()) {
    triggerValidation(document)
  }
}

connection.onInitialize(() => {
  validateAll()
  return {
    capabilities: {
      textDocumentSync: documents.syncKind
    }
  }
})

connection.onDidChangeConfiguration(({settings}) => {
  config = settings.config
  configOverrides = settings.configOverrides
  validateAll()
})

connection.onDidChangeWatchedFiles(validateAll)

documents.onDidChangeContent(({document}) => triggerValidation(document))
documents.onDidClose(({document}) => {
  cleanPendingValidation(document)
  connection.sendDiagnostics({uri: document.uri, diagnostics: []})
})

documents.listen(connection)

connection.listen()
