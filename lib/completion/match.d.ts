/**
 * Rules:
 * - First strict 5, first case match 2.5
 * - First word character strict 2.5, first word character case 2
 * - First fuzzy match strict 1, first fuzzy case 0.5
 * - Follow strict 1, follow case 0.5
 * - Follow word start 1, follow word case 0.75
 * - First fuzzy strict 0.1, first fuzzy case 0.05
 *
 * @public
 * @param {string} word
 * @param {number[]} input
 * @returns {number}
 */
export declare function matchScore(word: string, input: number[]): number;
