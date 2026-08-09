import { createRepository, db, type FinanceDatabase } from '../data/db'
import type { Transaction } from '../types'
import { decryptOperation } from './crypto'
import type { SyncCredentials, SyncEventRow, SyncOperation, SyncOutboxRecord } from './types'

function transactionWins(incoming: Transaction, current: Transaction) {
  if (incoming.updatedAt !== current.updatedAt) {
    return incoming.updatedAt > current.updatedAt
  }
  return JSON.stringify(incoming) > JSON.stringify(current)
}

export async function applySyncOperation(operation: SyncOperation, database: FinanceDatabase = db) {
  const targetRepository = createRepository(database)
  if (operation.kind === 'clear_data') {
    await targetRepository.clearUserData()
    return
  }
  if (operation.kind === 'put_transaction') {
    const local = await database.transactions.get(operation.transaction.id)
    if (!local || transactionWins(operation.transaction, local)) await database.transactions.put(operation.transaction)
    return
  }
  if (operation.kind === 'delete_transaction') {
    await database.transactions.delete(operation.id)
    return
  }
  if (operation.kind === 'put_category') {
    await database.categories.put(operation.category)
    return
  }
  if (operation.kind === 'put_budget') {
    await database.budgets.put(operation.budget)
    return
  }
  if (operation.kind === 'delete_budget') {
    await database.budgets.delete(operation.id)
    return
  }
  await database.transaction('rw', database.transactions, database.categories, database.budgets, database.settings, async () => {
    const localTransactions = new Map((await database.transactions.toArray()).map((item) => [item.id, item]))
    const incomingTransactions = operation.snapshot.transactions.filter((item) => {
      const local = localTransactions.get(item.id)
      if (!local) return true
      return transactionWins(item, local)
    })
    if (incomingTransactions.length) await database.transactions.bulkPut(incomingTransactions)
    if (operation.snapshot.categories.length) await database.categories.bulkPut(operation.snapshot.categories)
    if (operation.snapshot.budgets.length) await database.budgets.bulkPut(operation.snapshot.budgets)
    if (operation.snapshot.settings) await database.settings.put(operation.snapshot.settings)
  })
}

export async function applyRemoteEvent(
  row: SyncEventRow,
  credentials: SyncCredentials,
  database: FinanceDatabase = db,
) {
  if (row.room_id !== credentials.roomId) return 'foreign-room' as const
  if (await database.syncAppliedEvents.get(row.id)) return 'duplicate' as const
  const operation = await decryptOperation(row.ciphertext, row.iv, credentials.encryptionKey)
  await applySyncOperation(operation, database)
  await database.syncAppliedEvents.put({
    id: row.id,
    roomId: row.room_id,
    appliedAt: new Date().toISOString(),
  })
  return 'applied' as const
}

export async function queueSyncOperation(
  credentials: SyncCredentials,
  operation: SyncOperation,
  database: FinanceDatabase = db,
  createId: () => string = () => crypto.randomUUID(),
) {
  const record: SyncOutboxRecord = {
    id: createId(),
    roomId: credentials.roomId,
    operation,
    createdAt: new Date().toISOString(),
  }
  await database.syncOutbox.put(record)
  return record
}
