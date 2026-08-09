import type { Category, MonthlyBudget, Transaction, TransactionType } from '../types'

export const todayIso = () => new Date().toISOString().slice(0, 10)
export const currentMonth = () => todayIso().slice(0, 7)

export function parseAmountToCents(value: string | number): number | null {
  const normalized = String(value).trim().replace(/[¥￥,，\s]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null
  const amount = Number(normalized)
  if (!Number.isFinite(amount) || amount <= 0 || amount > 99999999) return null
  return Math.round(amount * 100)
}

export function formatMoney(cents: number, showSign = false): string {
  const amount = cents / 100
  const formatted = new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2,
  }).format(Math.abs(amount))
  if (!showSign || cents === 0) return cents < 0 ? `-${formatted}` : formatted
  return `${cents > 0 ? '+' : '-'}${formatted}`
}

export function monthLabel(month: string): string {
  const [year, value] = month.split('-')
  return `${year}年${Number(value)}月`
}

export function transactionFingerprint(input: Pick<Transaction, 'date' | 'type' | 'amountCents' | 'note'> & { categoryName: string }): string {
  return [input.date, input.type, input.categoryName.trim(), input.amountCents, input.note.trim()].join('|')
}

export function summarizeMonth(transactions: Transaction[], month: string) {
  const rows = transactions.filter((item) => item.date.startsWith(month))
  const income = rows.filter((item) => item.type === 'income').reduce((sum, item) => sum + item.amountCents, 0)
  const expense = rows.filter((item) => item.type === 'expense').reduce((sum, item) => sum + item.amountCents, 0)
  return { income, expense, balance: income - expense, count: rows.length }
}

export function getBudgetSummary(transactions: Transaction[], budgets: MonthlyBudget[], month: string) {
  const monthExpenses = transactions.filter((item) => item.type === 'expense' && item.date.startsWith(month))
  const limit = budgets.filter((item) => item.month === month).reduce((sum, item) => sum + item.limitCents, 0)
  const budgetedIds = new Set(budgets.filter((item) => item.month === month).map((item) => item.categoryId))
  const spent = monthExpenses.filter((item) => budgetedIds.has(item.categoryId)).reduce((sum, item) => sum + item.amountCents, 0)
  return { limit, spent, remaining: limit - spent, percent: limit ? Math.round((spent / limit) * 100) : 0 }
}

export function categoryTotals(transactions: Transaction[], categories: Category[], month: string, type: TransactionType = 'expense') {
  const map = new Map<string, number>()
  transactions
    .filter((item) => item.type === type && item.date.startsWith(month))
    .forEach((item) => map.set(item.categoryId, (map.get(item.categoryId) ?? 0) + item.amountCents))
  return [...map.entries()]
    .map(([categoryId, value]) => {
      const category = categories.find((item) => item.id === categoryId)
      return { categoryId, name: category?.name ?? '未分类', value, color: category?.color ?? '#77736a' }
    })
    .sort((a, b) => b.value - a.value)
}

export function recentMonths(endMonth: string, count = 6): string[] {
  const [year, month] = endMonth.split('-').map(Number)
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(year, month - 1 - (count - 1 - index), 1)
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
  })
}
