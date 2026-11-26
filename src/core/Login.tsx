import { useState, type FormEvent } from 'react'
import { sb } from './supabase'
import { errText } from './ui'

export function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr('')
    const { error } = await sb().auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) setErr(/invalid/i.test(error.message) ? 'Email hoặc mật khẩu chưa đúng.' : errText(error))
  }

  return (
    <div className="login-wrap">
      <form className="mem-card login-card stack" onSubmit={submit}>
        <div>
          <div className="eyebrow">Quản lý doanh nghiệp</div>
          <h1 className="page-title" style={{ fontSize: 26 }}>Đăng nhập</h1>
          <p className="mem-caption" style={{ margin: 0 }}>Dùng tài khoản do chủ doanh nghiệp cấp.</p>
        </div>
        <div className="field">
          <label htmlFor="em">Email</label>
          <input id="em" className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="pw">Mật khẩu</label>
          <input id="pw" className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {err && <div className="alert bad" role="alert">{err}</div>}
        <button className="mem-btn mem-btn-primary" style={{ justifyContent: 'center', minHeight: 44 }} disabled={busy}>
          {busy ? 'Đang đăng nhập...' : 'Đăng nhập'}
        </button>
      </form>
    </div>
  )
}
