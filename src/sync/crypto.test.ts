import { describe, expect, it } from 'vitest'
import {
  decodePairingPayload, decryptOperation, encodePairingPayload, encryptOperation, randomSecret,
} from './crypto'

describe('端到端加密同步', () => {
  it('可以编码并还原配对钥匙', () => {
    const payload = {
      version: 1 as const,
      roomId: '22222222-2222-4222-8222-222222222222',
      inviteToken: randomSecret(),
      encryptionKey: randomSecret(),
    }
    const code = encodePairingPayload(payload)
    expect(decodePairingPayload(`https://example.test/#sync=${code}`)).toEqual(payload)
  })

  it('拒绝损坏的配对码', () => {
    expect(() => decodePairingPayload('not-a-pairing-code')).toThrow('配对链接无效')
  })

  it('使用 AES-GCM 加密和解密同步事件', async () => {
    const key = randomSecret()
    const operation = { kind: 'delete_transaction' as const, id: 'transaction-1' }
    const encrypted = await encryptOperation(operation, key)
    expect(encrypted.ciphertext).not.toContain('transaction-1')
    await expect(decryptOperation(encrypted.ciphertext, encrypted.iv, key)).resolves.toEqual(operation)
    await expect(decryptOperation(encrypted.ciphertext, encrypted.iv, randomSecret())).rejects.toThrow()
  })

  it('拒绝损坏密文且每次加密使用不同 IV', async () => {
    const key = randomSecret()
    const operation = { kind: 'delete_transaction' as const, id: 'transaction-1' }
    const encrypted = await Promise.all(Array.from({ length: 32 }, () => encryptOperation(operation, key)))
    expect(new Set(encrypted.map((item) => item.iv))).toHaveLength(32)

    const damaged = `${encrypted[0].ciphertext.slice(0, -2)}aa`
    await expect(decryptOperation(damaged, encrypted[0].iv, key)).rejects.toThrow()
  })
})
