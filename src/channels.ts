import { Neovim } from '@chemzqm/neovim'
import { URI } from 'vscode-uri'
import BufferChannel from './model/outputChannel'
import { TextDocumentContentProvider } from './provider'
import { OutputChannel } from './types'

const outputChannels: Map<string, OutputChannel> = new Map()

export class Channels {

  /**
   * Get text document provider
   */
  public getProvider(nvim: Neovim): TextDocumentContentProvider {
    let provider: TextDocumentContentProvider = {
      onDidChange: null,
      provideTextDocumentContent: async (uri: URI) => {
        let channel = this.get(uri.path.slice(1))
        if (!channel) return ''
        nvim.pauseNotification()
        nvim.command('setlocal nospell nofoldenable nowrap noswapfile', true)
        nvim.command('setlocal buftype=nofile bufhidden=hide', true)
        nvim.command('setfiletype log', true)
        await nvim.resumeNotification()
        return channel.content
      }
    }
    return provider
  }

  public get names(): string[] {
    return Array.from(outputChannels.keys())
  }

  public get(channelName: string): OutputChannel | null {
    return outputChannels.get(channelName)
  }

  public create(name: string, nvim: Neovim): OutputChannel | null {
    if (outputChannels.has(name)) return outputChannels.get(name)
    if (!/^[\w\s-.]+$/.test(name)) throw new Error(`Invalid channel name "${name}", only word characters and white space allowed.`)
    let channel = new BufferChannel(name, nvim)
    outputChannels.set(name, channel)
    return channel
  }

  public show(name: string, preserveFocus?: boolean): void {
    let channel = outputChannels.get(name)
    if (!channel) return
    channel.show(preserveFocus)
  }

  public dispose(): void {
    for (let channel of outputChannels.values()) {
      channel.dispose()
    }
    outputChannels.clear()
  }
}

export default new Channels()
