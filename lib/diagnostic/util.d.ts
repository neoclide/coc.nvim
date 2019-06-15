import { DiagnosticSeverity, Diagnostic } from 'vscode-languageserver-protocol';
import { LocationListItem } from '../types';
export declare function getSeverityName(severity: DiagnosticSeverity): string;
export declare function getSeverityType(severity: DiagnosticSeverity): string;
export declare function severityLevel(level: string): number;
export declare function getNameFromSeverity(severity: DiagnosticSeverity): string;
export declare function getLocationListItem(owner: string, bufnr: number, diagnostic: Diagnostic): LocationListItem;
