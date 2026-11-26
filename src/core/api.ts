import { sb, isDemo } from './supabase'
import { DEMO_BRANCHES, DEMO_USER_ID, loadTable, saveTable, uid } from './demo'
import type { Access, Branch, Profile, Role } from './types'

export interface UserRow extends Profile {
  branch_ids: string[]
  /** Quyền gán riêng cho người này (ngoài quyền theo vai trò) */
  extra_perms: string[]
}

export async function loadAccess(userId: string): Promise<Access | null> {
  if (isDemo) {
    return {
      profile: { id: DEMO_USER_ID, full_name: 'Người dùng xem thử', role: 'owner', is_active: true },
      perms: ['*'],
    }
  }
  const c = sb()
  const { data: profile, error } = await c.from('profiles').select('*').eq('id', userId).maybeSingle()
  if (error) throw error
  if (!profile) return null
  if (profile.role === 'owner') return { profile, perms: ['*'] }
  const [rp, up] = await Promise.all([
    c.from('role_permissions').select('perm').eq('role', profile.role),
    c.from('user_permissions').select('perm').eq('user_id', userId),
  ])
  if (rp.error) throw rp.error
  if (up.error) throw up.error
  const perms = new Set<string>([
    ...(rp.data ?? []).map((r) => r.perm as string),
    ...(up.data ?? []).map((r) => r.perm as string),
  ])
  return { profile, perms: [...perms] }
}

export async function listBranches(): Promise<Branch[]> {
  if (isDemo) return loadTable<Branch>('branches', () => DEMO_BRANCHES)
  const { data, error } = await sb().from('branches').select('*').order('name')
  if (error) throw error
  return data as Branch[]
}

export async function saveBranch(b: { id?: string; name: string; is_active?: boolean }): Promise<void> {
  if (isDemo) {
    const rows = loadTable<Branch>('branches', () => DEMO_BRANCHES)
    if (b.id) {
      saveTable('branches', rows.map((r) => (r.id === b.id ? { ...r, ...b } : r)))
    } else {
      saveTable('branches', [...rows, { id: uid(), name: b.name, is_active: true }])
    }
    return
  }
  const { error } = b.id
    ? await sb().from('branches').update({ name: b.name, is_active: b.is_active }).eq('id', b.id)
    : await sb().from('branches').insert({ name: b.name })
  if (error) throw error
}

export async function listUsers(): Promise<UserRow[]> {
  if (isDemo) {
    return [
      {
        id: DEMO_USER_ID, full_name: 'Người dùng xem thử', role: 'owner', is_active: true,
        branch_ids: DEMO_BRANCHES.map((b) => b.id), extra_perms: [],
      },
    ]
  }
  const c = sb()
  const [p, ub, up] = await Promise.all([
    c.from('profiles').select('*').order('created_at'),
    c.from('user_branches').select('*'),
    c.from('user_permissions').select('*'),
  ])
  if (p.error) throw p.error
  if (ub.error) throw ub.error
  if (up.error) throw up.error
  return (p.data as Profile[]).map((u) => ({
    ...u,
    branch_ids: (ub.data ?? []).filter((x) => x.user_id === u.id).map((x) => x.branch_id as string),
    extra_perms: (up.data ?? []).filter((x) => x.user_id === u.id).map((x) => x.perm as string),
  }))
}

export async function updateUser(
  id: string,
  patch: { full_name: string; role: Role; is_active: boolean },
  branchIds: string[],
  extraPerms: string[] = [],
): Promise<void> {
  if (isDemo) return
  const c = sb()
  const r1 = await c.from('profiles').update(patch).eq('id', id)
  if (r1.error) throw r1.error
  const r2 = await c.from('user_branches').delete().eq('user_id', id)
  if (r2.error) throw r2.error
  if (branchIds.length) {
    const r3 = await c.from('user_branches').insert(branchIds.map((b) => ({ user_id: id, branch_id: b })))
    if (r3.error) throw r3.error
  }
  const r4 = await c.from('user_permissions').delete().eq('user_id', id)
  if (r4.error) throw r4.error
  if (extraPerms.length) {
    const r5 = await c.from('user_permissions').insert(extraPerms.map((perm) => ({ user_id: id, perm })))
    if (r5.error) throw r5.error
  }
}
