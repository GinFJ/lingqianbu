import type { PairingPayload, SyncOperation } from './types'

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

export function randomSecret(byteLength = 32): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)))
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', textEncoder.encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function importEncryptionKey(encodedKey: string) {
  const raw = base64UrlToBytes(encodedKey)
  if (raw.length !== 32) throw new Error('配对密钥格式不正确')
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function encryptOperation(operation: SyncOperation, encodedKey: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await importEncryptionKey(encodedKey)
  const plaintext = textEncoder.encode(JSON.stringify(operation))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
  return { ciphertext: bytesToBase64Url(new Uint8Array(encrypted)), iv: bytesToBase64Url(iv) }
}

export async function decryptOperation(ciphertext: string, encodedIv: string, encodedKey: string): Promise<SyncOperation> {
  const key = await importEncryptionKey(encodedKey)
  const iv = base64UrlToBytes(encodedIv)
  const encrypted = base64UrlToBytes(ciphertext)
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted)
  return JSON.parse(textDecoder.decode(plaintext)) as SyncOperation
}

export function encodePairingPayload(payload: PairingPayload): string {
  return bytesToBase64Url(textEncoder.encode(JSON.stringify({
    v: payload.version,
    r: payload.roomId,
    s: payload.inviteToken,
    k: payload.encryptionKey,
  })))
}

export function decodePairingPayload(input: string): PairingPayload {
  let code = input.trim()
  if (!code) throw new Error('请输入配对链接或配对码')

  if (code.includes('#sync=')) code = code.split('#sync=')[1]
  else if (code.startsWith('#sync=')) code = code.slice(6)
  code = code.split('&')[0]

  try {
    const parsed = JSON.parse(textDecoder.decode(base64UrlToBytes(code))) as { v?: number; r?: string; s?: string; k?: string }
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    if (parsed.v !== 1 || !parsed.r || !uuidPattern.test(parsed.r)) throw new Error()
    if (!parsed.s || base64UrlToBytes(parsed.s).length !== 32) throw new Error()
    if (!parsed.k || base64UrlToBytes(parsed.k).length !== 32) throw new Error()
    return { version: 1, roomId: parsed.r, inviteToken: parsed.s, encryptionKey: parsed.k }
  } catch {
    throw new Error('配对链接无效或已经损坏')
  }
}
