import type { JwtDecodedResult, JwtVerificationResult, UrlInspectResult } from './types.js';
export declare function decodeBase64UrlToUtf8(segment: string): string;
export declare function encodeUtf8ToBase64Url(input: string): string;
export declare function decodeJwtToken(rawInput: string, nowMs?: number): JwtDecodedResult;
export declare function verifyJwtHmacSha256(rawToken: string, secret: string): Promise<JwtVerificationResult>;
export declare function signJwtHmacSha256(payload: Record<string, unknown>, secret: string, headerOverrides?: Record<string, unknown>): Promise<string>;
export declare function parseAndInspectUrl(rawInput: string): UrlInspectResult;
