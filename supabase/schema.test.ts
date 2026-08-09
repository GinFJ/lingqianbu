// @vitest-environment node
import { readFile } from 'node:fs/promises'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'

const USERS = {
  owner: '11111111-1111-4111-8111-111111111111',
  member: '22222222-2222-4222-8222-222222222222',
  outsider: '33333333-3333-4333-8333-333333333333',
}
const ROOMS = {
  owner: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  outsider: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
}

let database: PGlite

async function asRole<T>(role: 'anon' | 'authenticated', userId: string | undefined, action: () => Promise<T>) {
  await database.query(`select set_config('request.jwt.claim.sub', $1, false)`, [userId ?? ''])
  await database.exec(`set role ${role}`)
  try {
    return await action()
  } finally {
    await database.exec('reset role')
    await database.query(`select set_config('request.jwt.claim.sub', '', false)`)
  }
}

beforeAll(async () => {
  database = new PGlite()
  await database.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;

    create schema extensions;
    create function extensions.digest(input bytea, algorithm text) returns bytea
      language sql immutable strict
      as $$ select decode(md5(convert_from(input, 'UTF8')) || md5(convert_from(input, 'UTF8') || ':2'), 'hex') $$;
    create publication supabase_realtime;
  `)

  const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8')
  await database.exec(schema.replace(/create extension if not exists pgcrypto with schema extensions;\s*/i, ''))
  await database.query('insert into auth.users (id) select unnest($1::uuid[])', [Object.values(USERS)])
})

afterAll(async () => {
  await database.close()
})

describe('Supabase RLS 隔离对抗测试', () => {
  it('三个公开表全部启用 RLS，anon 没有数据权限或 RPC 权限', async () => {
    const result = await database.query<{ tablename: string; rowsecurity: boolean }>(`
      select tablename, rowsecurity
      from pg_tables
      where schemaname = 'public' and tablename like 'sync_%'
      order by tablename
    `)
    expect(result.rows).toEqual([
      { tablename: 'sync_events', rowsecurity: true },
      { tablename: 'sync_room_members', rowsecurity: true },
      { tablename: 'sync_rooms', rowsecurity: true },
    ])

    const privileges = await database.query<{
      publicHelperRemoved: boolean
      privateHelperPresent: boolean
      anonCreateDenied: boolean
      anonJoinDenied: boolean
      eventUpdateDenied: boolean
      eventDeleteDenied: boolean
    }>(`
      select
        to_regprocedure('public.is_sync_room_member(uuid)') is null as "publicHelperRemoved",
        to_regprocedure('private.is_sync_room_member(uuid)') is not null as "privateHelperPresent",
        not has_function_privilege('anon', 'public.create_sync_room(uuid,text)', 'execute') as "anonCreateDenied",
        not has_function_privilege('anon', 'public.join_sync_room(uuid,text)', 'execute') as "anonJoinDenied",
        not has_table_privilege('authenticated', 'public.sync_events', 'update') as "eventUpdateDenied",
        not has_table_privilege('authenticated', 'public.sync_events', 'delete') as "eventDeleteDenied"
    `)
    expect(privileges.rows[0]).toEqual({
      publicHelperRemoved: true,
      privateHelperPresent: true,
      anonCreateDenied: true,
      anonJoinDenied: true,
      eventUpdateDenied: true,
      eventDeleteDenied: true,
    })

    await asRole('anon', undefined, async () => {
      await expect(database.query('select * from public.sync_rooms')).rejects.toThrow()
      await expect(database.query('select public.create_sync_room($1, $2)', [ROOMS.owner, '0'.repeat(64)])).rejects.toThrow()
      await expect(database.query(`insert into public.sync_events (id, room_id, device_id, ciphertext, iv)
        values ($1, $2, $3, 'ciphertext', '123456789012')`, [crypto.randomUUID(), ROOMS.owner, crypto.randomUUID()])).rejects.toThrow()
    })
  })

  it('非成员看不到房间、成员或事件，也不能直接写表', async () => {
    await asRole('authenticated', USERS.outsider, async () => {
      expect((await database.query('select * from public.sync_rooms')).rows).toHaveLength(0)
      expect((await database.query('select * from public.sync_room_members')).rows).toHaveLength(0)
      expect((await database.query('select * from public.sync_events')).rows).toHaveLength(0)
      await expect(database.query(`insert into public.sync_rooms (id, invite_secret_hash, created_by)
        values ($1, $2, $3)`, [ROOMS.owner, '0'.repeat(64), USERS.outsider])).rejects.toThrow()
      await expect(database.query(`insert into public.sync_room_members (room_id, user_id)
        values ($1, $2)`, [ROOMS.owner, USERS.outsider])).rejects.toThrow()
    })
  })

  it('成员只能通过 RPC 加入，并只可读取自己的成员记录和房间密文事件', async () => {
    const inviteToken = 'isolated-owner-secret'
    const hash = (await database.query<{ hash: string }>(`
      select encode(extensions.digest(convert_to($1, 'UTF8'), 'sha256'), 'hex') as hash
    `, [inviteToken])).rows[0].hash
    const outsiderHash = (await database.query<{ hash: string }>(`
      select encode(extensions.digest(convert_to('outsider-secret', 'UTF8'), 'sha256'), 'hex') as hash
    `)).rows[0].hash

    await asRole('authenticated', USERS.owner, async () => {
      await expect(database.query('select public.create_sync_room($1, $2)', [ROOMS.owner, hash])).resolves.toBeDefined()
      expect((await database.query('select id from public.sync_rooms')).rows).toEqual([{ id: ROOMS.owner }])
      expect((await database.query('select user_id from public.sync_room_members')).rows).toEqual([{ user_id: USERS.owner }])
      await expect(database.query(`insert into public.sync_events (id, room_id, device_id, ciphertext, iv)
        values ($1, $2, $3, 'owner-ciphertext', '123456789012')`, [
        '44444444-4444-4444-8444-444444444444', ROOMS.owner, crypto.randomUUID(),
      ])).resolves.toBeDefined()
      await expect(database.query(`update public.sync_events set ciphertext = 'tampered' where room_id = $1`, [ROOMS.owner])).rejects.toThrow()
      await expect(database.query(`delete from public.sync_events where room_id = $1`, [ROOMS.owner])).rejects.toThrow()
    })

    await asRole('authenticated', USERS.member, async () => {
      await expect(database.query('select public.join_sync_room($1, $2)', [ROOMS.owner, 'wrong-secret'])).rejects.toThrow()
      await expect(database.query('select public.join_sync_room($1, $2)', [ROOMS.owner, inviteToken])).resolves.toBeDefined()
      expect((await database.query('select user_id from public.sync_room_members')).rows).toEqual([{ user_id: USERS.member }])
      expect((await database.query('select ciphertext from public.sync_events')).rows).toEqual([{ ciphertext: 'owner-ciphertext' }])
      await expect(database.query(`insert into public.sync_events (id, room_id, device_id, ciphertext, iv)
        values ($1, $2, $3, '', '123456789012')`, [crypto.randomUUID(), ROOMS.owner, crypto.randomUUID()])).rejects.toThrow()
    })

    await asRole('authenticated', USERS.outsider, async () => {
      await database.query('select public.create_sync_room($1, $2)', [ROOMS.outsider, outsiderHash])
      expect((await database.query('select id from public.sync_rooms')).rows).toEqual([{ id: ROOMS.outsider }])
      expect((await database.query('select ciphertext from public.sync_events')).rows).toHaveLength(0)
      await expect(database.query(`insert into public.sync_events (id, room_id, device_id, ciphertext, iv)
        values ($1, $2, $3, 'cross-room', '123456789012')`, [crypto.randomUUID(), ROOMS.owner, crypto.randomUUID()])).rejects.toThrow()
    })

    await asRole('authenticated', USERS.owner, async () => {
      expect((await database.query('select user_id from public.sync_room_members')).rows).toEqual([{ user_id: USERS.owner }])
      expect((await database.query('select id from public.sync_rooms')).rows).toEqual([{ id: ROOMS.owner }])
    })
  })
})
