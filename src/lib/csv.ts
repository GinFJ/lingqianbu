import Papa from 'papaparse'
import type { Category, CsvParseResult, Transaction } from '../types'
import { transactionFingerprint } from './finance'

type RawCsvRow = Record<string, string>

const TYPE_MAP: Record<string, 'income' | 'expense' | undefined> = {
  收入: 'income',
  支出: 'expense',
  income: 'income',
  expense: 'expense',
}

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}

function parseCsvAmount(value: string) {
  const normalized = value.trim().replace(/[¥￥,，\s]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null
  const amount = Number(normalized)
  if (!Number.isFinite(amount) || amount <= 0 || amount > 99999999) return null
  return Math.round(amount * 100)
}

export function parseTransactionsCsv(text: string, transactions: Transaction[], categories: Category[]): CsvParseResult {
  const result = Papa.parse<RawCsvRow>(text.replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: 'greedy' })
  const valid: CsvParseResult['valid'] = []
  const errors: CsvParseResult['errors'] = []

  if (result.errors.some((error) => error.code === 'MissingQuotes')) {
    errors.push({ rowNumber: 1, message: 'CSV 中存在未闭合的引号' })
  }

  const existingFingerprints = new Set(
    transactions.map((item) => {
      const categoryName = categories.find((category) => category.id === item.categoryId)?.name ?? '未分类'
      return transactionFingerprint({ ...item, categoryName })
    }),
  )
  const seen = new Set<string>()

  result.data.forEach((row, index) => {
    const rowNumber = index + 2
    const date = (row['日期'] ?? '').trim()
    const type = TYPE_MAP[(row['类型'] ?? '').trim().toLowerCase()]
    const categoryName = (row['分类'] ?? '').trim()
    const amountCents = parseCsvAmount(row['金额'] ?? '')
    const note = (row['备注'] ?? '').trim()

    const rowErrors: string[] = []
    if (!isValidDate(date)) rowErrors.push('日期应为 YYYY-MM-DD 且必须真实存在')
    if (!type) rowErrors.push('类型只能是“收入”或“支出”')
    if (!categoryName) rowErrors.push('分类不能为空')
    if (amountCents === null) rowErrors.push('金额必须是大于 0 且最多两位小数的数字')

    if (rowErrors.length || !type || amountCents === null) {
      errors.push({ rowNumber, message: rowErrors.join('；') })
      return
    }

    const fingerprint = transactionFingerprint({ date, type, categoryName, amountCents, note })
    const isDuplicate = existingFingerprints.has(fingerprint) || seen.has(fingerprint)
    seen.add(fingerprint)
    valid.push({ rowNumber, date, type, categoryName, amountCents, note, fingerprint, isDuplicate })
  })

  return { valid, errors }
}

export function transactionsToCsv(transactions: Transaction[], categories: Category[]) {
  const rows = transactions.map((item) => ({
    日期: item.date,
    类型: item.type === 'income' ? '收入' : '支出',
    分类: categories.find((category) => category.id === item.categoryId)?.name ?? '未分类',
    金额: (item.amountCents / 100).toFixed(2),
    备注: item.note,
  }))
  return `\uFEFF${Papa.unparse(rows, { columns: ['日期', '类型', '分类', '金额', '备注'], newline: '\r\n' })}`
}

export function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
