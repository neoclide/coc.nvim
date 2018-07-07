import Uri from 'vscode-uri'
import {LanguageClient} from '../../language-client/main'

export default class SolargraphDocumentProvider {
  private docs: {[uri: string]: string}

  constructor(private languageClient: LanguageClient) {
    this.docs = {}
  }

  public updateAll(): void {
    Object.keys(this.docs).forEach(uri => {
      this.update(uri)
    })
  }

  public remove(uri: string): void {
    delete this.docs[uri]
  }

  public provideTextDocumentContent(uri: string): string {
    if (!this.docs[uri]) {
      this.update(uri)
    }
    return this.docs[uri.toString()] || 'Loading...'
  }

  private parseQuery(query: string): any {
    let result = {}
    let parts = query.split('&')
    parts.forEach(part => {
      let frag = part.split('=')
      result[frag[0]] = frag[1]
    })
    return result
  }

  public update(uri: string): void {
    let method = '$/solargraph' + Uri.parse(uri).path
    let query = this.parseQuery(Uri.parse(uri).query)
    this.languageClient
      .sendRequest(method, {query: query.query})
      .then((result: any) => {
        this.docs[uri.toString()] = result.content
      })
  }

}
