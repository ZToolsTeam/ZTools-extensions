import type { CodeTargetLang, HttpResponseSnapshot, ParsedCurlRequest } from './types.js';
export declare function tokenizeShellCommand(raw: string): string[];
export declare function parseCurlCommand(rawInput: string): ParsedCurlRequest;
export declare function generateCodeFromCurl(parsed: ParsedCurlRequest, lang: CodeTargetLang): string;
export declare function executeCurlRequest(parsed: ParsedCurlRequest, options?: {
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
}): Promise<HttpResponseSnapshot>;
