import Source from './source';
import { QueryOption } from '../types';
export default abstract class ServiceSource extends Source {
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
