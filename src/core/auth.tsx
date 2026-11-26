import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { isDemo, supabase } from './supabase'
import { listBranches, loadAccess } from './api'
import type { Access, Branch } from './types'

interface Ctx {
  loading: boolean
  loggedIn: boolean
  access: Access | null
  /** Tài khoản đã đăng nhập nhưng chưa có hồ sơ hoặc bị khóa */
  blocked: boolean
  branches: Branch[]
  /** Chi nhánh đang chọn; '' = tất cả chi nhánh được phép */
  branchId: string
  setBranchId: (id: string) => void
  can: (perm: string) => boolean
  signOut: () => Promise<void>
  reloadBranches: () => Promise<void>
}

const AuthCtx = createContext<Ctx | null>(null)

export function useAuth(): Ctx {
  const c = useContext(AuthCtx)
  if (!c) throw new Error('useAuth ngoài AuthProvider')
  return c
}

const BRANCH_KEY = 'qltc-branch'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState<Session | null>(null)
  const [access, setAccess] = useState<Access | null>(null)
  const [blocked, setBlocked] = useState(false)
  const [branches, setBranches] = useState<Branch[]>([])
  const [branchId, setBranchIdState] = useState<string>(() => localStorage.getItem(BRANCH_KEY) ?? '')

  const reloadBranches = useCallback(async () => {
    setBranches((await listBranches()).filter((b) => b.is_active))
  }, [])

  const hydrate = useCallback(async (userId: string) => {
    try {
      const a = await loadAccess(userId)
      if (!a || !a.profile.is_active) {
        setBlocked(true)
        setAccess(null)
        return
      }
      setBlocked(false)
      setAccess(a)
      await reloadBranches()
    } catch (e) {
      console.error(e)
      setBlocked(true)
    }
  }, [reloadBranches])

  useEffect(() => {
    let alive = true
    if (isDemo) {
      hydrate('demo').finally(() => alive && setLoading(false))
      return () => { alive = false }
    }
    supabase!.auth.getSession().then(async ({ data }) => {
      if (!alive) return
      setSession(data.session)
      if (data.session) await hydrate(data.session.user.id)
      if (alive) setLoading(false)
    })
    const { data: sub } = supabase!.auth.onAuthStateChange((_evt, s) => {
      setSession(s)
      if (s) void hydrate(s.user.id)
      else { setAccess(null); setBlocked(false) }
    })
    return () => { alive = false; sub.subscription.unsubscribe() }
  }, [hydrate])

  const setBranchId = (id: string) => {
    setBranchIdState(id)
    localStorage.setItem(BRANCH_KEY, id)
  }

  const value = useMemo<Ctx>(() => {
    // nếu chi nhánh đã lưu không còn hợp lệ thì quay về "tất cả"
    const valid = branchId === '' || branches.some((b) => b.id === branchId)
    return {
      loading,
      loggedIn: isDemo || !!session,
      access,
      blocked,
      branches,
      branchId: valid ? branchId : '',
      setBranchId,
      can: (p: string) => !!access && (access.perms.includes('*') || p.split('|').some((x) => access.perms.includes(x))),
      signOut: async () => {
        if (isDemo) return
        await supabase!.auth.signOut()
      },
      reloadBranches,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, session, access, blocked, branches, branchId, reloadBranches])

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}
