export type VaultCategory = 'login' | 'apikey' | 'server' | 'license'

export interface VaultEntry {
  id: string
  title: string
  category: VaultCategory
  categoryLabel: string
  username: string
  endpoint: string
  secretPlain: string
  note: string
  updatedAt: number
  updatedAtShort: string
}

export interface EncryptedVaultEnvelope {
  /** 1：PBKDF2 固定 10 万次；2：迭代次数记录在 kdfIterations */
  version: 1 | 2
  kdfIterations?: number
  saltBase64: string
  ivBase64: string
  cipherTextBase64: string
}

export interface VaultNewEntryInput {
  title: string
  category: VaultCategory
  username?: string
  endpoint?: string
  secretPlain: string
  note?: string
}
