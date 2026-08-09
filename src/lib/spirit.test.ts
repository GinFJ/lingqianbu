import { describe, expect, it } from 'vitest'
import { answerLedgerSpirit, extractPreferredName } from './spirit'
import type { Category, MonthlyBudget, Transaction } from '../types'

const categories: Category[] = [
  { id: 'food', name: '餐饮', type: 'expense', color: '#b94b3b', icon: 'Utensils', isBuiltin: true },
  { id: 'salary', name: '工资', type: 'income', color: '#39716a', icon: 'Wallet', isBuiltin: true },
]

const transactions: Transaction[] = [
  { id: '1', type: 'income', amountCents: 800000, categoryId: 'salary', date: '2026-08-01', note: '', createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-01T00:00:00Z' },
  { id: '2', type: 'expense', amountCents: 12500, categoryId: 'food', date: '2026-08-02', note: '晚饭', createdAt: '2026-08-02T00:00:00Z', updatedAt: '2026-08-02T00:00:00Z' },
]

const budgets: MonthlyBudget[] = [
  { id: '2026-08:food', month: '2026-08', categoryId: 'food', limitCents: 50000 },
]

const context = { transactions, categories, budgets, month: '2026-08' }

describe('answerLedgerSpirit', () => {
  it('回答月度支出与最大分类', () => {
    expect(answerLedgerSpirit('这个月花了多少？', context)).toContain('花了 ¥125.00')
    expect(answerLedgerSpirit('这个月花了多少？', context)).toContain('餐饮')
  })

  it('回答预算余额', () => {
    expect(answerLedgerSpirit('预算还剩多少？', context)).toContain('还剩 ¥375.00')
  })

  it('找到最近一笔流水', () => {
    expect(answerLedgerSpirit('最近一笔是什么？', context)).toContain('晚饭')
  })

  it('说明本机隐私边界', () => {
    expect(answerLedgerSpirit('数据会上传吗？', context)).toContain('账目先加密')
  })

  it('有明确的砚貅性格', () => {
    expect(answerLedgerSpirit('你是谁？', context)).toBe('阿砚。你喊一声，我就来翻账。')
    expect(answerLedgerSpirit('你今天心情怎么样？', context)).toContain('看着顺眼')
  })

  it('记住用户希望使用的称呼', () => {
    expect(extractPreferredName('以后叫我阿金')).toBe('阿金')
    expect(answerLedgerSpirit('你好', { ...context, userName: '阿金' })).toContain('阿金')
  })

  it('对购买问题先算预算', () => {
    expect(answerLedgerSpirit('我想买一个200块的东西，能买吗？', context)).toContain('买完还剩 ¥175.00')
  })
})
