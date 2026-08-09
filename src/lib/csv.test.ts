import { describe, expect, it } from 'vitest'
import type { Category, Transaction } from '../types'
import { parseTransactionsCsv, transactionsToCsv } from './csv'

const categories: Category[] = [{ id: 'food', name: '餐饮', type: 'expense', color: '#000', icon: 'Utensils', isBuiltin: true }]
const existing: Transaction[] = [{ id: '1', type: 'expense', amountCents: 1250, categoryId: 'food', date: '2026-08-01', note: '早餐', createdAt: '', updatedAt: '' }]

describe('CSV 导入', () => {
  it('解析合法记录并识别与现有流水重复的行', () => {
    const csv = '日期,类型,分类,金额,备注\n2026-08-01,支出,餐饮,12.50,早餐\n2026-08-02,收入,兼职,80,翻译'
    const result = parseTransactionsCsv(csv, existing, categories)
    expect(result.errors).toHaveLength(0)
    expect(result.valid).toHaveLength(2)
    expect(result.valid[0].isDuplicate).toBe(true)
    expect(result.valid[1].amountCents).toBe(8000)
  })

  it('报告非法日期、类型、空分类和金额', () => {
    const csv = '日期,类型,分类,金额,备注\n2026-02-30,转账,,1.234,坏数据'
    const result = parseTransactionsCsv(csv, [], categories)
    expect(result.valid).toHaveLength(0)
    expect(result.errors[0].message).toContain('日期')
    expect(result.errors[0].message).toContain('类型')
    expect(result.errors[0].message).toContain('分类')
    expect(result.errors[0].message).toContain('金额')
  })
})

describe('CSV 导出', () => {
  it('输出 BOM、固定中文表头并正确引用逗号', () => {
    const csv = transactionsToCsv([{ ...existing[0], note: '早餐,咖啡' }], categories)
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv).toContain('日期,类型,分类,金额,备注')
    expect(csv).toContain('"早餐,咖啡"')
  })
})
