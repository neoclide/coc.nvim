export interface Highlight {
    line: number;
    colStart: number;
    colEnd: number;
    hlGroup: string;
    isMarkdown?: boolean;
}
export declare function getHiglights(lines: string[], filetype: string): Promise<Highlight[]>;
