// src/App.jsx — versione finale con tutte le pagine
import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { supabase } from './supabase'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import MyTeam from './pages/MyTeam'
import Picks from './pages/Picks'
import Admin from './pages/Admin'
import Tournament from './pages/Tournament'
import Schedule from './pages/Schedule'
import History from './pages/History'

export default function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  if (loading) return <div className="loading-screen">FANTATENNIS</div>
  if (!session) return <Login />

  return (
    <BrowserRouter>
      <Layout session={session}>
        <Routes>
          <Route path="/"          element={<Dashboard  session={session} />} />
          <Route path="/torneo"    element={<Tournament session={session} />} />
          <Route path="/picks"     element={<Picks      session={session} />} />
          <Route path="/team"      element={<MyTeam     session={session} />} />
          <Route path="/calendario"element={<Schedule />} />
          <Route path="/storico"   element={<History    session={session} />} />
          <Route path="/admin"     element={<Admin      session={session} />} />
          <Route path="*"          element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  )
}
