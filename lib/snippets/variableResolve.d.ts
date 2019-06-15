import { Variable, VariableResolver } from "./parser";
import Document from '../model/document';
export declare class SnippetVariableResolver implements VariableResolver {
    private _variableToValue;
    private readonly nvim;
    init(document: Document): Promise<void>;
    constructor();
    resolve(variable: Variable): string;
}
