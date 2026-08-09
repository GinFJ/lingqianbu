import { describe, expect, it } from 'vitest'
import type { MonthlyBudget, Transaction } from '../types'
import { formatMoney, getBudgetSummary, parseAmountToCents, recentMonths, summarizeMonth } from './finance'

const transactions: Transaction[] = [
  { id: '1', type: 'income', amountCents: 500000, categoryId: 'salary', date: '2026-08-01', note: '', createdAt: '', updatedAt: '' },
  { id: '2', type: 'expense', amountCents: 12345, categoryId: 'food', date: '2026-08-02', note: '', createdAt: '', updatedAt: '' },
  { id: '3', type: 'expense', amountCents: 20000, categoryId: 'home', date: '2026-07-20', note: '', createdAt: '', updatedAt: '' },
]

describe('金额规则', () => {
  it('把合法人民币金额转成整数分', () => {
    expect(parseAmountToCents('￥1,234.56')).toBe(123456)
    expect(parseAmountToCents('0.01')).toBe(1)
  })

  it('拒绝零、负数、三位小数和非数字', () => {
    expect(parseAmountToCents('0')).toBeNull()
    expect(parseAmountToCents('-2')).toBeNull()
    expect(parseAmountToCents('2.345')).toBeNull()
    expect(parseAmountToCents('十二')).toBeNull()
  })

  it('以人民币格式展示正负金额', () => {
    expect(formatMoney(123456)).toContain('1,234.56')
    expect(formatMoney(-100)).toMatch(/-.*1\.00/)
  })
})

describe('月度汇总', () => {
  it('只统计指定月份并计算结余', () => {
    expect(summarizeMonth(transactions, '2026-08')).toEqual({ income: 500000, expense: 12345, balance: 487655, count: 2 })
  })

  it('预算只统计设置了预算的分类', () => {
    const budgets: MonthlyBudget[] = [{ id: 'a', month: '2026-08', categoryId: 'food', limitCents: 20000 }]
    expect(getBudgetSummary(transactions, budgets, '2026-08')).toEqual({ limit: 20000, spent: 12345, remaining: 7655, percent: 62 })
  })

  it('跨年生成连续月份', () => {
    expect(recentMonths('2026-02', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
  })
})
