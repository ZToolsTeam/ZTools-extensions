export type FontFilter = 'all' | 'with-license' | 'without-license' | 'system'
export interface InstalledFont { id: string; family: string; style: string; filePath: string; hasLicense: boolean; system: boolean }
export interface FontPreview { id: string; png: string; fallbacks: string[]; coverageWarning?: string; license: string; licenseUrl: string; copyright: string; manufacturer: string }
