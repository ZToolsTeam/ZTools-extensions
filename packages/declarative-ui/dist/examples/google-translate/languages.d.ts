export interface SupportedLanguage {
    code: string;
    name: string;
    nativeName: string;
    flag: string;
}
export declare const SUPPORTED_LANGUAGES: SupportedLanguage[];
export declare function getLanguageName(code: string): string;
