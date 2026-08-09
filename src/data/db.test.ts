import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'
import { parseTransactionsCsv } from '../lib/csv'
import { FinanceDatabase, importTransactions, initializeDatabase } from './db'

const opened: FinanceDatabase[] = []

function isolatedDatabase() {
  const database = new FinanceDatabase(`lingqianbu-test-${crypto.randomUUID()}`)
  opened.push(database)
  return database
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map(async (database) => {
    database.close()
    await database.delete()
  }))
})

describe('IndexedDB 隔离建库与升级', () => {
  it('全新数据库会建立默认分类和本机设置', async () => {
    const database = isolatedDatabase()
    await initializeDatabase(database)

    expect(await database.categories.count()).toBeGreaterThan(0)
    expect(await database.settings.get('main')).toEqual({
      id: 'main', locale: 'zh-CN', currency: 'CNY', hasVisited: false,
    })
    expect(database.verno).toBe(2)
  })

  it('从 v1 升级到 v2 时保留账目并新增同步存储', async () => {
    const name = `lingqianbu-v1-${crypto.randomUUID()}`
    const legacy = new Dexie(name)
    legacy.version(1).stores({
      transactions: 'id,date,type,categoryId,createdAt',
      categories: 'id,type,name',
      budgets: 'id,month,categoryId,[month+categoryId]',
      settings: 'id',
    })
    await legacy.open()
    await legacy.table('transactions').add({
      id: 'legacy-transaction', type: 'expense', amountCents: 1880,
      categoryId: 'food', date: '2026-08-08', note: '迁移保留',
      createdAt: '2026-08-08T08:00:00.000Z', updatedAt: '2026-08-08T08:00:00.000Z',
    })
    legacy.close()

    const database = new FinanceDatabase(name)
    opened.push(database)
    await database.open()

    expect((await database.transactions.get('legacy-transaction'))?.amountCents).toBe(1880)
    expect(database.tables.map((table) => table.name)).toEqual(expect.arrayContaining([
      'syncCredentials', 'syncOutbox', 'syncAppliedEvents',
    ]))
  })
})

describe('CSV 写入与失败恢复', () => {
  it('预检通过后按整数分写入日期、分类和备注', async () => {
    const database = isolatedDatabase()
    await initializeDatabase(database)
    const categories = await database.categories.toArray()
    const preview = parseTransactionsCsv(
      '日期,类型,分类,金额,备注\n2026-08-09,支出,学习,12.34,隔离导入',
      [],
      categories,
    )

    await expect(importTransactions(preview.valid, false, database)).resolves.toBe(1)
    const transaction = await database.transactions.toCollection().first()
    const category = transaction ? await database.categories.get(transaction.categoryId) : undefined
    expect(transaction).toMatchObject({ date: '2026-08-09', amountCents: 1234, note: '隔离导入' })
    expect(category?.name).toBe('学习')
  })

  it('批量写入中途失败时回滚流水和新分类', async () => {
    const database = isolatedDatabase()
    await initializeDatabase(database)
    const preview = parseTransactionsCsv(
      '日期,类型,分类,金额,备注\n2026-08-09,支出,临时分类,1.00,第一行\n2026-08-10,支出,临时分类,2.00,第二行',
      [],
      await database.categories.toArray(),
    )
    const fixedIds = ['category-id', 'duplicate-transaction', 'duplicate-transaction']

    await expect(importTransactions(preview.valid, false, database, () => fixedIds.shift() ?? 'duplicate-transaction')).rejects.toThrow()
    expect(await database.transactions.count()).toBe(0)
    expect(await database.categories.where('name').equals('临时分类').count()).toBe(0)
  })
})
