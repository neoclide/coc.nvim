import { CancellationToken, ColorInformation, ColorPresentation, Disposable, DocumentSelector, TextDocument } from 'vscode-languageserver-protocol';
import { DocumentColorProvider } from './index';
import Manager from './manager';
export default class DocumentColorManager extends Manager<DocumentColorProvider> implements Disposable {
    register(selector: DocumentSelector, provider: DocumentColorProvider): Disposable;
    provideDocumentColors(document: TextDocument, token: CancellationToken): Promise<ColorInformation[] | null>;
    provideColorPresentations(colorInformation: ColorInformation, document: TextDocument, token: CancellationToken): Promise<ColorPresentation[]>;
    dispose(): void;
}
