export interface MatchResult {
    score: number;
    matches?: number[];
}
export declare function getMatchResult(text: string, query: string, filename?: string): MatchResult;
