import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { db, importTransactions, initializeDatabase, repository } from '../data/db'
import { CATEGORY_COLORS } from '../data/defaults'
import type { AppSettings, Category, CsvRow, MonthlyBudget, Transaction, TransactionDraft } from '../types'
import { parseAmountToCents } from '../lib/finance'
import { syncService } from '../sync/service'
import type { SyncViewState } from '../sync/types'

interface FinanceState {
  transactions: Transaction[]
  categories: Category[]
  budgets: MonthlyBudget[]
  settings?: AppSettings
  sync: SyncViewState
  loading: boolean
  addTransaction: (draft: TransactionDraft) => Promise<void>
  updateTransaction: (id: string, draft: TransactionDraft) => Promise<void>
  deleteTransaction: (id: string) => Promise<void>
  setBudget: (month: string, categoryId: string, amount: string) => Promise<void>
  addCategory: (name: string, type: 'income' | 'expense') => Promise<Category>
  importRows: (rows: CsvRow[], includeDuplicates: boolean) => Promise<number>
  clearData: () => Promise<void>
  markVisited: () => Promise<void>
  createSyncRoom: () => Promise<string>
  joinSyncRoom: (pairingCode: string) => Promise<void>
  dismissPairing: () => void
  syncNow: () => Promise<void>
  disconnectSync: () => Promise<void>
}

const FinanceContext = createContext<FinanceState | null>(null)

export function FinanceProvider({ children }: { children: ReactNode }) {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [budgets, setBudgets] = useState<MonthlyBudget[]>([])
  const [settings, setSettings] = useState<AppSettings>()
  const [sync, setSync] = useState<SyncViewState>(syncService.getState())
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const snapshot = await repository.snapshot()
    setTransactions(snapshot.transactions)
    setCategories(snapshot.categories)
    setBudgets(snapshot.budgets)
    setSettings(snapshot.settings)
  }, [])

  useEffect(() => syncService.subscribe(setSync), [])

  useEffect(() => {
    initializeDatabase()
      .then(refresh)
      .then(() => syncService.initialize(refresh))
      .finally(() => setLoading(false))
  }, [refresh])

  const addTransaction = useCallback(async (draft: TransactionDraft) => {
    const amountCents = parseAmountToCents(draft.amount)
    if (!amountCents) throw new Error('请输入有效金额')
    const now = new Date().toISOString()
    const transaction: Transaction = {
      id: crypto.randomUUID(),
      type: draft.type,
      amountCents,
      categoryId: draft.categoryId,
      date: draft.date,
      note: draft.note.trim(),
      createdAt: now,
      updatedAt: now,
    }
    await repository.putTransaction(transaction)
    await syncService.enqueue({ kind: 'put_transaction', transaction }).catch(() => undefined)
    await refresh()
  }, [refresh])

  const updateTransaction = useCallback(async (id: string, draft: TransactionDraft) => {
    const existing = await db.transactions.get(id)
    const amountCents = parseAmountToCents(draft.amount)
    if (!existing || !amountCents) throw new Error('无法更新这笔流水')
    const transaction: Transaction = {
      ...existing,
      type: draft.type,
      amountCents,
      categoryId: draft.categoryId,
      date: draft.date,
      note: draft.note.trim(),
      updatedAt: new Date().toISOString(),
    }
    await repository.putTransaction(transaction)
    await syncService.enqueue({ kind: 'put_transaction', transaction }).catch(() => undefined)
    await refresh()
  }, [refresh])

  const deleteTransaction = useCallback(async (id: string) => {
    await repository.deleteTransaction(id)
    await syncService.enqueue({ kind: 'delete_transaction', id }).catch(() => undefined)
    await refresh()
  }, [refresh])

  const setBudget = useCallback(async (month: string, categoryId: string, amount: string) => {
    const limitCents = amount.trim() ? parseAmountToCents(amount) : 0
    if (limitCents === null) throw new Error('请输入有效预算')
    const budget = { id: `${month}:${categoryId}`, month, categoryId, limitCents }
    await repository.putBudget(budget)
    await syncService.enqueue(limitCents > 0 ? { kind: 'put_budget', budget } : { kind: 'delete_budget', id: budget.id }).catch(() => undefined)
    await refresh()
  }, [refresh])

  const addCategory = useCallback(async (name: string, type: 'income' | 'expense') => {
    const trimmed = name.trim()
    if (!trimmed) throw new Error('分类名称不能为空')
    const duplicate = categories.find((item) => item.type === type && item.name === trimmed)
    if (duplicate) return duplicate
    const category: Category = {
      id: `custom-${crypto.randomUUID()}`,
      name: trimmed,
      type,
      color: CATEGORY_COLORS[categories.filter((item) => !item.isBuiltin).length % CATEGORY_COLORS.length],
      icon: type === 'income' ? 'CirclePlus' : 'Tag',
      isBuiltin: false,
    }
    await repository.putCategory(category)
    await syncService.enqueue({ kind: 'put_category', category }).catch(() => undefined)
    await refresh()
    return category
  }, [categories, refresh])

  const importRows = useCallback(async (rows: CsvRow[], includeDuplicates: boolean) => {
    const imported = await importTransactions(rows, includeDuplicates)
    const snapshot = await repository.snapshot()
    await syncService.enqueue({ kind: 'snapshot', snapshot }).catch(() => undefined)
    await refresh()
    return imported
  }, [refresh])

  const clearData = useCallback(async () => {
    await repository.clearUserData()
    await syncService.enqueue({ kind: 'clear_data' }).catch(() => undefined)
    await refresh()
  }, [refresh])

  const markVisited = useCallback(async () => {
    await repository.markVisited()
    await refresh()
  }, [refresh])

  const createSyncRoom = useCallback(async () => syncService.createRoom(await repository.snapshot()), [])
  const joinSyncRoom = useCallback(async (pairingCode: string) => syncService.joinRoom(pairingCode), [])
  const dismissPairing = useCallback(() => syncService.dismissPairing(), [])
  const syncNow = useCallback(async () => syncService.syncNow(), [])
  const disconnectSync = useCallback(async () => syncService.disconnect(), [])

  const value = useMemo(() => ({
    transactions, categories, budgets, settings, sync, loading, addTransaction, updateTransaction,
    deleteTransaction, setBudget, addCategory, importRows, clearData, markVisited,
    createSyncRoom, joinSyncRoom, dismissPairing, syncNow, disconnectSync,
  }), [transactions, categories, budgets, settings, sync, loading, addTransaction, updateTransaction, deleteTransaction, setBudget, addCategory, importRows, clearData, markVisited, createSyncRoom, joinSyncRoom, dismissPairing, syncNow, disconnectSync])

  return <FinanceContext.Provider value={value}>{children}</FinanceContext.Provider>
}

export function useFinance() {
  const value = useContext(FinanceContext)
  if (!value) throw new Error('useFinance must be used inside FinanceProvider')
  return value
}
