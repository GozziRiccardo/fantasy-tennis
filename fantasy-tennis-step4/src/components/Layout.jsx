// src/components/Layout.jsx — versione finale con tutti i link
import { NavLink, useNavigate } from 'react-router-dom'
import { supabase } from '../supabase'
import './Layout.css'

const ADMIN_EMAIL = 'TUA_EMAIL@esempio.com'  // ← cambia con la tua email

const NAV = [
  { to: '/',           label: 'Classifica',  icon: '◈' },
  { to: '/torneo',     label: 'Torneo',      icon: '◐' },
  { to: '/picks',      label: 'Schiera',     icon: '◎' },
  { to: '/team',       label: 'La mia rosa', icon: '◉' },
  { to: '/calendario', label: 'Calendario',  icon: '◷' },
  { to: '/storico',    label: 'Storico',     icon: '◫' },
]

export default function Layout({ session, children }) {
  const navigate = useNavigate()
  const isAdmin  = session.user.email === ADMIN_EMAIL

  async function signOut() {
    await supabase.auth.signOut()
    navigate('/')
  }

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-logo">
          <span className="display">Fanta<span className="accent-text">Tennis</span></span>
        </div>

        <nav className="sidebar-nav">
          {NAV.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
            >
              <span className="nav-icon">{icon}</span>
              <span>{label}</span>
            </NavLink>
          ))}

          {isAdmin && (
            <>
              <div className="nav-divider" />
              <NavLink
                to="/admin"
                className={({ isActive }) => `nav-item nav-item-admin ${isActive ? 'active' : ''}`}
              >
                <span className="nav-icon">⚙</span>
                <span>Admin</span>
              </NavLink>
            </>
          )}
        </nav>

        <div className="sidebar-footer">
          <div className="user-chip">
            <div className="user-avatar">
              {session.user.email?.[0]?.toUpperCase() ?? '?'}
            </div>
            <span className="user-email">{session.user.email}</span>
          </div>
          <button className="btn btn-ghost sign-out-btn" onClick={signOut}>
            Esci
          </button>
        </div>
      </aside>

      <main className="main-content">
        {children}
      </main>
    </div>
  )
}
