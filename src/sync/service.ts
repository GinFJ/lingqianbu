import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import { db, repository } from '../data/db'
import { decodePairingPayload, encodePairingPayload, encryptOperation, randomSecret, sha256Hex } from './crypto'
import { applyRemoteEvent, queueSyncOperation } from './apply'
import type {
  FinanceSnapshot, PairingPayload, SyncCredentials, SyncEventRow, SyncOperation, SyncViewState,
} from './types'

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL ?? '').trim()
const supabaseKey = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim()
const isConfigured = Boolean(supabaseUrl && supabaseKey)

type StateListener = (state: SyncViewState) => void

function pairingLink(payload: PairingPayload) {
  const code = encodePairingPayload(payload)
  if (typeof window === 'undefined') return code
  return `${window.location.origin}${window.location.pathname}#sync=${code}`
}

class LedgerSyncService {
  private client: SupabaseClient | null = null
  private channel: RealtimeChannel | null = null
  private credentials?: SyncCredentials
  private listeners = new Set<StateListener>()
  private remoteChanged?: () => void | Promise<void>
  private initialized = false
  private flushing = false
  private connecting?: Promise<void>
  private state: SyncViewState = {
    available: isConfigured,
    paired: false,
    status: isConfigured ? 'off' : 'unavailable',
    queued: 0,
  }

  getState() { return this.state }

  subscribe(listener: StateListener) {
    this.listeners.add(listener)
    listener(this.state)
    return () => { this.listeners.delete(listener) }
  }

  private update(patch: Partial<SyncViewState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((listener) => listener(this.state))
  }

  private getClient() {
    if (!isConfigured) throw new Error('同步服务尚未配置')
    if (!this.client) {
      this.client = createClient(supabaseUrl, supabaseKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      })
    }
    return this.client
  }

  private consumePairingHash() {
    if (typeof window === 'undefined') return undefined
    const hashCode = window.location.hash.startsWith('#sync=') ? window.location.hash.slice(6) : ''
    if (hashCode) {
      sessionStorage.setItem('lingqianbu-pending-pairing', hashCode)
      history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
    }
    return hashCode || sessionStorage.getItem('lingqianbu-pending-pairing') || undefined
  }

  async initialize(remoteChanged: () => void | Promise<void>) {
    this.remoteChanged = remoteChanged
    if (this.initialized) return
    this.initialized = true
    const pendingPairingCode = this.consumePairingHash()
    this.credentials = await db.syncCredentials.get('active')
    const queued = this.credentials ? await db.syncOutbox.where('roomId').equals(this.credentials.roomId).count() : 0
    this.update({
      available: isConfigured,
      paired: Boolean(this.credentials),
      status: !isConfigured ? 'unavailable' : this.credentials ? (navigator.onLine ? 'connecting' : 'offline') : 'off',
      queued,
      pendingPairingCode,
      pairingLink: this.credentials ? this.makePairingLink(this.credentials) : undefined,
    })
    window.addEventListener('online', this.handleOnline)
    window.addEventListener('offline', this.handleOffline)
    if (this.credentials && isConfigured) void this.connect()
  }

  private handleOnline = () => { if (this.credentials) void this.connect() }
  private handleOffline = () => { if (this.credentials) this.update({ status: 'offline' }) }

  private async authenticate() {
    const client = this.getClient()
    const { data } = await client.auth.getSession()
    if (data.session) return data.session.user
    const { data: signedIn, error } = await client.auth.signInAnonymously()
    if (error || !signedIn.user) throw new Error(error?.message || '无法建立匿名设备身份')
    return signedIn.user
  }

  private makePairingLink(credentials: SyncCredentials) {
    return pairingLink({
      version: 1,
      roomId: credentials.roomId,
      inviteToken: credentials.inviteToken,
      encryptionKey: credentials.encryptionKey,
    })
  }

  async createRoom(snapshot: FinanceSnapshot) {
    if (!isConfigured) throw new Error('请先配置同步服务地址')
    const client = this.getClient()
    await this.authenticate()
    const credentials: SyncCredentials = {
      id: 'active',
      roomId: crypto.randomUUID(),
      inviteToken: randomSecret(),
      encryptionKey: randomSecret(),
      deviceId: crypto.randomUUID(),
      pairedAt: new Date().toISOString(),
    }
    const inviteHash = await sha256Hex(credentials.inviteToken)
    const { error } = await client.rpc('create_sync_room', {
      p_room_id: credentials.roomId,
      p_invite_secret_hash: inviteHash,
    })
    if (error) throw new Error(`无法新建同步账簿：${error.message}`)
    await db.syncCredentials.put(credentials)
    this.credentials = credentials
    this.update({ paired: true, status: 'connecting', pairingLink: this.makePairingLink(credentials), error: undefined })
    await this.enqueue({ kind: 'snapshot', snapshot }, false)
    await this.connect()
    return this.makePairingLink(credentials)
  }

  async joinRoom(input: string) {
    if (!isConfigured) throw new Error('请先配置同步服务地址')
    const payload = decodePairingPayload(input)
    const credentials: SyncCredentials = {
      id: 'active',
      roomId: payload.roomId,
      inviteToken: payload.inviteToken,
      encryptionKey: payload.encryptionKey,
      deviceId: crypto.randomUUID(),
      pairedAt: new Date().toISOString(),
    }
    await db.syncCredentials.put(credentials)
    this.credentials = credentials
    this.update({ paired: true, status: 'connecting', pairingLink: this.makePairingLink(credentials), error: undefined })
    try {
      await this.connect()
      const mergedSnapshot = await repository.snapshot()
      await this.enqueue({ kind: 'snapshot', snapshot: mergedSnapshot })
      sessionStorage.removeItem('lingqianbu-pending-pairing')
      this.update({ pendingPairingCode: undefined })
    } catch (reason) {
      await db.syncCredentials.delete('active')
      this.credentials = undefined
      this.update({ paired: false, status: 'error', pairingLink: undefined, error: reason instanceof Error ? reason.message : '配对失败' })
      throw reason
    }
  }

  dismissPairing() {
    sessionStorage.removeItem('lingqianbu-pending-pairing')
    this.update({ pendingPairingCode: undefined })
  }

  async enqueue(operation: SyncOperation, flush = true) {
    if (!this.credentials) return
    await queueSyncOperation(this.credentials, operation)
    await this.refreshQueueCount()
    if (flush && navigator.onLine) void this.flush()
  }

  private async refreshQueueCount() {
    const queued = this.credentials ? await db.syncOutbox.where('roomId').equals(this.credentials.roomId).count() : 0
    this.update({ queued })
  }

  async connect() {
    if (!this.credentials || !isConfigured) return
    if (this.connecting) return this.connecting
    this.connecting = this.performConnect().finally(() => { this.connecting = undefined })
    return this.connecting
  }

  private async performConnect() {
    if (!this.credentials || !navigator.onLine) {
      this.update({ status: 'offline' })
      return
    }
    this.update({ status: 'connecting', error: undefined })
    const credentials = this.credentials
    const client = this.getClient()
    await this.authenticate()
    const { error: joinError } = await client.rpc('join_sync_room', {
      p_room_id: credentials.roomId,
      p_invite_secret: credentials.inviteToken,
    })
    if (joinError) throw new Error(`无法进入同步账簿：${joinError.message}`)

    if (this.channel) await client.removeChannel(this.channel)
    this.channel = client
      .channel(`ledger-${credentials.roomId}-${credentials.deviceId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'sync_events', filter: `room_id=eq.${credentials.roomId}`,
      }, (payload) => { void this.receive(payload.new as SyncEventRow) })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') this.update({ status: 'online', error: undefined })
        else if (status === 'CHANNEL_ERROR') this.update({ status: 'error', error: '实时连接暂时不可用' })
        else if (status === 'TIMED_OUT' || status === 'CLOSED') this.update({ status: 'offline' })
      })

    await this.fetchRemoteEvents()
    await this.flush()
  }

  private async fetchRemoteEvents() {
    if (!this.credentials) return
    const client = this.getClient()
    let from = 0
    const pageSize = 500
    while (true) {
      const { data, error } = await client
        .from('sync_events')
        .select('id,room_id,device_id,ciphertext,iv,created_at')
        .eq('room_id', this.credentials.roomId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, from + pageSize - 1)
      if (error) throw new Error(`读取同步记录失败：${error.message}`)
      const rows = (data ?? []) as SyncEventRow[]
      for (const row of rows) await this.receive(row)
      if (rows.length < pageSize) break
      from += pageSize
    }
  }

  private async receive(row: SyncEventRow) {
    const credentials = this.credentials
    if (!credentials || row.room_id !== credentials.roomId) return
    try {
      const result = await applyRemoteEvent(row, credentials)
      if (result !== 'applied') return
      this.update({ lastSyncedAt: row.created_at, status: 'online', error: undefined })
      await this.remoteChanged?.()
    } catch (reason) {
      this.update({ status: 'error', error: reason instanceof Error ? reason.message : '收到一条无法解密的同步记录' })
    }
  }

  async flush() {
    if (this.flushing || !this.credentials || !isConfigured || !navigator.onLine) return
    this.flushing = true
    const credentials = this.credentials
    try {
      await this.authenticate()
      const outbox = await db.syncOutbox.where('roomId').equals(credentials.roomId).sortBy('createdAt')
      for (const record of outbox) {
        const encrypted = await encryptOperation(record.operation, credentials.encryptionKey)
        const { error } = await this.getClient().from('sync_events').insert({
          id: record.id,
          room_id: credentials.roomId,
          device_id: credentials.deviceId,
          ciphertext: encrypted.ciphertext,
          iv: encrypted.iv,
        })
        if (error && error.code !== '23505') throw new Error(error.message)
        await db.transaction('rw', db.syncOutbox, db.syncAppliedEvents, async () => {
          await db.syncOutbox.delete(record.id)
          await db.syncAppliedEvents.put({ id: record.id, roomId: credentials.roomId, appliedAt: new Date().toISOString() })
        })
        this.update({ lastSyncedAt: new Date().toISOString() })
      }
      await this.refreshQueueCount()
      this.update({ status: this.channel ? 'online' : 'connecting', error: undefined })
    } catch (reason) {
      this.update({ status: navigator.onLine ? 'error' : 'offline', error: reason instanceof Error ? reason.message : '同步失败' })
    } finally {
      this.flushing = false
    }
  }

  async syncNow() {
    await this.connect()
    await this.fetchRemoteEvents()
    await this.flush()
  }

  async disconnect() {
    const roomId = this.credentials?.roomId
    if (this.channel && this.client) await this.client.removeChannel(this.channel)
    this.channel = null
    this.credentials = undefined
    await db.transaction('rw', db.syncCredentials, db.syncOutbox, db.syncAppliedEvents, async () => {
      await db.syncCredentials.delete('active')
      if (roomId) {
        await db.syncOutbox.where('roomId').equals(roomId).delete()
        await db.syncAppliedEvents.where('roomId').equals(roomId).delete()
      }
    })
    this.update({ paired: false, status: isConfigured ? 'off' : 'unavailable', queued: 0, pairingLink: undefined, lastSyncedAt: undefined, error: undefined })
  }
}

export const syncService = new LedgerSyncService()
