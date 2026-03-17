import { useState } from 'react'
import { supabase } from '../supabase'
import './Login.css'

export default function Login() {
  const [mode, setMode]       = useState('login')   // 'login' | 'signup'
  const [email, setEmail]     = useState('')
  const [password, setPass]   = useState('')
  const [username, setUser]   = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [info, setInfo]       = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setInfo('')
    setLoading(true)

    if (mode === 'signup') {
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { username } },
      })
      if (error) setError(error.message)
      else setInfo('Controlla la tua email per confermare la registrazione.')
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(error.message)
    }

    setLoading(false)
  }

  return (
    <div className="login-page">
      <div className="login-bg-text display" aria-hidden>TENNIS</div>

      <div className="login-box card">
        <div className="login-header">
          <div className="login-logo display">
            Fanta<span style={{ color: 'var(--accent)' }}>Tennis</span>
          </div>
          <p className="login-tagline">
            {mode === 'login' ? 'Bentornato.' : 'Crea il tuo account.'}
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          {error && <div className="error-msg">{error}</div>}
          {info  && <div className="success-msg">{info}</div>}

          {mode === 'signup' && (
            <div className="field">
              <label className="label">Username</label>
              <input
                className="input"
                type="text"
                placeholder="il tuo soprannome"
                value={username}
                onChange={e => setUser(e.target.value)}
                required
                minLength={2}
                maxLength={20}
              />
            </div>
          )}

          <div className="field">
            <label className="label">Email</label>
            <input
              className="input"
              type="email"
              placeholder="tu@email.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="field">
            <label className="label">Password</label>
            <input
              className="input"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={e => setPass(e.target.value)}
              required
              minLength={6}
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', marginTop: 8 }}
            disabled={loading}
          >
            {loading ? 'Caricamento…' : mode === 'login' ? 'Entra' : 'Registrati'}
          </button>
        </form>

        <div className="login-switch">
          {mode === 'login' ? (
            <>Non hai un account?{' '}
              <button className="link-btn" onClick={() => { setMode('signup'); setError(''); setInfo('') }}>
                Registrati
              </button>
            </>
          ) : (
            <>Hai già un account?{' '}
              <button className="link-btn" onClick={() => { setMode('login'); setError(''); setInfo('') }}>
                Accedi
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
