import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, getToken, setToken } from './api'

export interface User { username: string; role: 'Verifikator' | 'Supervisor' | 'Admin'; name: string; facilities: string[] | null }
interface Ctx {
  user: User | null
  login: (u: string, p: string) => Promise<void>
  logout: () => void
  config: any
  run: any | null
  refreshRun: () => Promise<void>
  theme: 'light' | 'dark'
  setTheme: (t: 'light' | 'dark') => void
  reduced: boolean
  setReduced: (v: boolean) => void
  booting: boolean
}
const AppCtx = createContext<Ctx>(null as unknown as Ctx)
export const useApp = () => useContext(AppCtx)

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [config, setConfig] = useState<any>(null)
  const [run, setRun] = useState<any | null>(null)
  const [booting, setBooting] = useState(true)
  const [reduced, setReducedState] = useState(() => {
    try { const s = localStorage.getItem('pt_reduced'); return s === null ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : s === '1' } catch { return false }
  })

  const [theme, setThemeState] = useState<'light' | 'dark'>(() => (document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light'))
  const setTheme = (t: 'light' | 'dark') => {
    try { localStorage.setItem('pt_theme', t) } catch { /* abaikan */ }
    document.documentElement.setAttribute('data-theme', t)
    setThemeState(t)
  }
  const setReduced = (v: boolean) => {
    try { localStorage.setItem('pt_reduced', v ? '1' : '0') } catch { /* abaikan */ }
    setReducedState(v)
  }
  useEffect(() => { document.documentElement.classList.toggle('reduce-motion', reduced) }, [reduced])

  const refreshRun = useCallback(async () => {
    try { setRun(await api('/runs/latest')) } catch { setRun(null) }
  }, [])

  const logout = useCallback(() => { setToken(''); setUser(null); setRun(null) }, [])
  useEffect(() => {
    const h = () => logout()
    window.addEventListener('pt-logout', h)
    return () => window.removeEventListener('pt-logout', h)
  }, [logout])

  useEffect(() => {
    (async () => {
      setConfig(await api('/config').catch(() => null))
      try {
        if (getToken()) {
          setUser(await api('/auth/me'))
          await refreshRun()
        }
      } catch { setToken('') }
      setBooting(false)
    })()
  }, [refreshRun])

  const login = async (username: string, password: string) => {
    const r = await api('/auth/login', { json: { username, password } })
    setToken(r.token)
    setUser(r.user)
    await refreshRun()
  }
  const value = useMemo(() => ({ user, login, logout, config, run, refreshRun, theme, setTheme, reduced, setReduced, booting }), [user, config, run, theme, reduced, booting, logout, refreshRun])
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>
}

export const canRun = (u: User | null) => !!u && (u.role === 'Supervisor' || u.role === 'Admin')
