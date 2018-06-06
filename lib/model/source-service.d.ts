import { Neovim } from 'neovim';
import Source from './source';
import { QueryOption, SourceOption } from '../types';
export default abstract class ServiceSource extends Source {
    constructor(nvim: Neovim, option: SourceOption);
    protected previewMessage(msg: string): Promise<void>;
    protected echoMessage(line: string): Promise<void>;
    protected promptList(items: string[]): Promise<string>;
    protected echoLines(lines: string[]): Promise<void>;
    bindEvents(): Promise<void>;
    showDefinition(query: QueryOption): Promise<void>;
    showDocuments(query: QueryOption): Promise<void>;
    jumpDefinition(query: QueryOption): Promise<void>;
    showSignature(query: QueryOption): Promise<void>;
}
