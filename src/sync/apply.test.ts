import { afterEach, describe, expect, it } from 'vitest'
import { FinanceDatabase, initializeDatabase } from '../data/db'
import { encryptOperation, randomSecret } from './crypto'
import { applyRemoteEvent, applySyncOperation, queueSyncOperation } from './apply'
import type { SyncCredentials, SyncEventRow } from './types'

const opened: FinanceDatabase[] = []

function isolatedDatabase() {
  const database = new FinanceDatabase(`lingqianbu-sync-${crypto.randomUUID()}`)
  opened.push(database)
  return database
}

function credentials(): SyncCredentials {
  return {
    id: 'active',
    roomId: '22222222-2222-4222-8222-222222222222',
    inviteToken: randomSecret(),
    encryptionKey: randomSecret(),
    deviceId: '33333333-3333-4333-8333-333333333333',
    pairedAt: '2026-08-09T00:00:00.000Z',
  }
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map(async (database) => {
    database.close()
    await database.delete()
  }))
})

describe('同步事件应用', () => {
  it('重复事件只应用一次', async () => {
    const database = isolatedDatabase()
    await initializeDatabase(database)
    const secret = credentials()
    const transaction = {
      id: 'transaction-1', type: 'expense' as const, amountCents: 999,
      categoryId: 'food', date: '2026-08-09', note: '只写一次',
      createdAt: '2026-08-09T01:00:00.000Z', updatedAt: '2026-08-09T01:00:00.000Z',
    }
    const encrypted = await encryptOperation({ kind: 'put_transaction', transaction }, secret.encryptionKey)
    const row: SyncEventRow = {
      id: '44444444-4444-4444-8444-444444444444', room_id: secret.roomId,
      device_id: secret.deviceId, created_at: '2026-08-09T01:01:00.000Z', ...encrypted,
    }

    await expect(applyRemoteEvent(row, secret, database)).resolves.toBe('applied')
    await expect(applyRemoteEvent(row, secret, database)).resolves.toBe('duplicate')
    expect(await database.transactions.count()).toBe(1)
    expect(await database.syncAppliedEvents.count()).toBe(1)
  })

  it('错误密钥或损坏密文不改本机账目，也不标记为已应用', async () => {
    const database = isolatedDatabase()
    await initializeDatabase(database)
    const secret = credentials()
    const encrypted = await encryptOperation({ kind: 'clear_data' }, randomSecret())
    const row: SyncEventRow = {
      id: '55555555-5555-4555-8555-555555555555', room_id: secret.roomId,
      device_id: secret.deviceId, created_at: '2026-08-09T01:02:00.000Z', ...encrypted,
    }

    await expect(applyRemoteEvent(row, secret, database)).rejects.toThrow()
    expect(await database.categories.count()).toBeGreaterThan(0)
    expect(await database.syncAppliedEvents.count()).toBe(0)
  })

  it('并发修改按更新时间和稳定内容裁决，处理顺序不同仍收敛', async () => {
    const first = isolatedDatabase()
    const second = isolatedDatabase()
    await Promise.all([initializeDatabase(first), initializeDatabase(second)])
    const base = {
      id: 'transaction-conflict', type: 'expense' as const, amountCents: 100,
      categoryId: 'food', date: '2026-08-09', createdAt: '2026-08-09T02:00:00.000Z',
      updatedAt: '2026-08-09T02:30:00.000Z',
    }
    const deviceA = { kind: 'put_transaction' as const, transaction: { ...base, note: '设备 A' } }
    const deviceB = { kind: 'put_transaction' as const, transaction: { ...base, note: '设备 B' } }

    await applySyncOperation(deviceA, first)
    await applySyncOperation(deviceB, first)
    await applySyncOperation(deviceB, second)
    await applySyncOperation(deviceA, second)

    expect(await first.transactions.get(base.id)).toEqual(await second.transactions.get(base.id))
    expect((await first.transactions.get(base.id))?.note).toBe('设备 B')
  })
})

describe('离线队列', () => {
  it('关闭并重新打开数据库后仍保留待发送事件', async () => {
    const name = `lingqianbu-offline-${crypto.randomUUID()}`
    const first = new FinanceDatabase(name)
    opened.push(first)
    await initializeDatabase(first)
    const secret = credentials()
    await first.syncCredentials.put(secret)
    await queueSyncOperation(secret, { kind: 'delete_transaction', id: 'offline-delete' }, first, () => 'queued-event')
    first.close()

    const reopened = new FinanceDatabase(name)
    opened.push(reopened)
    await reopened.open()
    expect(await reopened.syncOutbox.get('queued-event')).toMatchObject({
      roomId: secret.roomId,
      operation: { kind: 'delete_transaction', id: 'offline-delete' },
    })
  })
})
