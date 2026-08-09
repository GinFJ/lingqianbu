import Dexie, { type EntityTable } from 'dexie'
import { CATEGORY_COLORS, DEFAULT_CATEGORIES } from './defaults'
import type { AppSettings, Category, CsvRow, MonthlyBudget, Transaction } from '../types'
import type { SyncAppliedEvent, SyncCredentials, SyncOutboxRecord } from '../sync/types'

export class FinanceDatabase extends Dexie {
  transactions!: EntityTable<Transaction, 'id'>
  categories!: EntityTable<Category, 'id'>
  budgets!: EntityTable<MonthlyBudget, 'id'>
  settings!: EntityTable<AppSettings, 'id'>
  syncCredentials!: EntityTable<SyncCredentials, 'id'>
  syncOutbox!: EntityTable<SyncOutboxRecord, 'id'>
  syncAppliedEvents!: EntityTable<SyncAppliedEvent, 'id'>

  constructor(name = 'lingqianbu') {
    super(name)
    this.version(1).stores({
      transactions: 'id,date,type,categoryId,createdAt',
      categories: 'id,type,name',
      budgets: 'id,month,categoryId,[month+categoryId]',
      settings: 'id',
    })
    this.version(2).stores({
      transactions: 'id,date,type,categoryId,createdAt',
      categories: 'id,type,name',
      budgets: 'id,month,categoryId,[month+categoryId]',
      settings: 'id',
      syncCredentials: 'id,roomId',
      syncOutbox: 'id,roomId,createdAt',
      syncAppliedEvents: 'id,roomId,appliedAt',
    })
  }
}

export const db = new FinanceDatabase()

export async function initializeDatabase(database = db) {
  await database.transaction('rw', database.categories, database.settings, async () => {
    if ((await database.categories.count()) === 0) await database.categories.bulkAdd(DEFAULT_CATEGORIES)
    if (!(await database.settings.get('main'))) {
      await database.settings.add({ id: 'main', locale: 'zh-CN', currency: 'CNY', hasVisited: false })
    }
  })
}

export async function importTransactions(
  rows: CsvRow[],
  includeDuplicates: boolean,
  database = db,
  createId: () => string = () => crypto.randomUUID(),
) {
  let imported = 0
  await database.transaction('rw', database.transactions, database.categories, async () => {
    const localCategories = await database.categories.toArray()
    for (const row of rows) {
      if (row.isDuplicate && !includeDuplicates) continue
      let category = localCategories.find((item) => item.type === row.type && item.name === row.categoryName)
      if (!category) {
        category = {
          id: `custom-${createId()}`,
          name: row.categoryName,
          type: row.type,
          color: CATEGORY_COLORS[localCategories.length % CATEGORY_COLORS.length],
          icon: row.type === 'income' ? 'CirclePlus' : 'Tag',
          isBuiltin: false,
        }
        await database.categories.add(category)
        localCategories.push(category)
      }
      const now = new Date().toISOString()
      await database.transactions.add({
        id: createId(),
        type: row.type,
        amountCents: row.amountCents,
        categoryId: category.id,
        date: row.date,
        note: row.note,
        createdAt: now,
        updatedAt: now,
      })
      imported += 1
    }
  })
  return imported
}

export function createRepository(database: FinanceDatabase) {
  return {
  async snapshot() {
    const [transactions, categories, budgets, settings] = await Promise.all([
      database.transactions.orderBy('date').reverse().toArray(),
      database.categories.toArray(),
      database.budgets.toArray(),
      database.settings.get('main'),
    ])
    return { transactions, categories, budgets, settings }
  },
  putTransaction(transaction: Transaction) {
    return database.transactions.put(transaction)
  },
  deleteTransaction(id: string) {
    return database.transactions.delete(id)
  },
  putBudget(budget: MonthlyBudget) {
    return budget.limitCents > 0 ? database.budgets.put(budget) : database.budgets.delete(budget.id)
  },
  putCategory(category: Category) {
    return database.categories.put(category)
  },
  markVisited() {
    return database.settings.update('main', { hasVisited: true })
  },
  async clearUserData() {
    await database.transaction('rw', database.transactions, database.budgets, database.categories, database.settings, async () => {
      await database.transactions.clear()
      await database.budgets.clear()
      await database.categories.clear()
      await database.categories.bulkAdd(DEFAULT_CATEGORIES)
      await database.settings.put({ id: 'main', locale: 'zh-CN', currency: 'CNY', hasVisited: false })
    })
  },
  }
}

export const repository = createRepository(db)
