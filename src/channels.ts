import { Neovim } from '@chemzqm/neovim'
import BufferChannel from './model/outputChannel'
import { OutputChannel } from './types'

const outputChannels: Map<string, OutputChannel> = new Map()

export class Channels {

  public get names(): string[] {
    return Array.from(outputChannels.keys())
  }

  public get(channelName: string): OutputChannel | null {
    return outputChannels.get(channelName)
  }

  public create(name: string, nvim: Neovim): OutputChannel | null {
    if (outputChannels.has(name)) return outputChannels.get(name)
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
