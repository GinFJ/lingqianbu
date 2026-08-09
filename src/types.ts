export type TransactionType = 'income' | 'expense'

export interface Transaction {
  id: string
  type: TransactionType
  amountCents: number
  categoryId: string
  date: string
  note: string
  createdAt: string
  updatedAt: string
}

export interface Category {
  id: string
  name: string
  type: TransactionType
  color: string
  icon: string
  isBuiltin: boolean
}

export interface MonthlyBudget {
  id: string
  month: string
  categoryId: string
  limitCents: number
}

export interface AppSettings {
  id: 'main'
  locale: 'zh-CN'
  currency: 'CNY'
  hasVisited: boolean
}

export interface TransactionDraft {
  type: TransactionType
  amount: string
  categoryId: string
  date: string
  note: string
}

export interface CsvRow {
  rowNumber: number
  date: string
  type: TransactionType
  categoryName: string
  amountCents: number
  note: string
  fingerprint: string
  isDuplicate: boolean
}

export interface CsvParseResult {
  valid: CsvRow[]
  errors: Array<{ rowNumber: number; message: string }>
}
