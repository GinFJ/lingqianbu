import type { AppSettings, Category, MonthlyBudget, Transaction } from '../types'

export interface FinanceSnapshot {
  transactions: Transaction[]
  categories: Category[]
  budgets: MonthlyBudget[]
  settings?: AppSettings
}

export type SyncOperation =
  | { kind: 'snapshot'; snapshot: FinanceSnapshot }
  | { kind: 'put_transaction'; transaction: Transaction }
  | { kind: 'delete_transaction'; id: string }
  | { kind: 'put_category'; category: Category }
  | { kind: 'put_budget'; budget: MonthlyBudget }
  | { kind: 'delete_budget'; id: string }
  | { kind: 'clear_data' }

export interface SyncCredentials {
  id: 'active'
  roomId: string
  inviteToken: string
  encryptionKey: string
  deviceId: string
  pairedAt: string
}

export interface SyncOutboxRecord {
  id: string
  roomId: string
  operation: SyncOperation
  createdAt: string
}

export interface SyncAppliedEvent {
  id: string
  roomId: string
  appliedAt: string
}

export interface SyncEventRow {
  id: string
  room_id: string
  device_id: string
  ciphertext: string
  iv: string
  created_at: string
}

export interface PairingPayload {
  version: 1
  roomId: string
  inviteToken: string
  encryptionKey: string
}

export type SyncStatus = 'unavailable' | 'off' | 'connecting' | 'online' | 'offline' | 'error'

export interface SyncViewState {
  available: boolean
  paired: boolean
  status: SyncStatus
  queued: number
  lastSyncedAt?: string
  pairingLink?: string
  pendingPairingCode?: string
  error?: string
}
