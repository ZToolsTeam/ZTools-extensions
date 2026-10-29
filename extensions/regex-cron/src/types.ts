export type RegexCronMode = 'dict' | 'tester' | 'cron'

export type RegexCategory = 'identity' | 'business' | 'finance' | 'traffic' | 'network' | 'format'

export interface RegexPresetItem {
  id: string
  title: string
  category: RegexCategory
  categoryLabel: string
  tags: string[]
  pattern: string
  recommendedFlags?: string
  description: string
  scope: string
  validExamples: string[]
  invalidExamples: string[]
}

export interface CronParseResult {
  timeZone?: string
  dialect?: string
  calculatedAt?: string
  isValid: boolean
  expression: string
  chineseSummary: string
  errorMessage?: string
  slots: Array<{
    name: string
    value: string
    meaning: string
  }>
  nextRuns: Array<{
    formattedTime: string
    utcOffset: string
    relativeTime: string
    timestamp: number
  }>
}

export interface RegexMatchResult {
  pattern?: string
  flags?: string
  truncated?: boolean
  isValidRegex: boolean
  errorMessage?: string
  totalMatches: number
  elapsedMs: number
  matches: Array<{
    index: number
    text: string
    start: number
    end: number
    groups: Array<{
      groupIndex: number
      name?: string
      value: string
      start: number
      end: number
    }>
  }>
}
