import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { motion, useScroll, useSpring } from 'framer-motion'
import { Command, LogOut, Menu, Moon, Sun, Zap, ZapOff } from 'lucide-react'
import { useApp } from '../lib/app'
import { utcToWib } from '../lib/format'
import CommandPalette from './CommandPalette'
import { NAV_ALL, NAV_MOBILE, navGroupsForUser, navItemsForUser } from './nav'
import { PixelMark, Sheet, SyntheticBadge } from './ui'

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/[.07] ring-1 ring-white/10"><PixelMark className="h-5 w-5" /></span>
      <div className="leading-tight">
        <div className="font-display text-lg font-bold tracking-tight text-white">Pharma<span className="text-lime">Trace</span>-AI</div>
        <div className="text-2xs text-white/45">DeveloperDay 2026</div>
      </div>
    </div>
  )
}

function UserCard({ onLogout }: { onLogout: () => void }) {
  const { user } = useApp()
  const initials = (user?.name ?? '?').split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase()
  return (
    <div className="rounded-xl bg-white/[.05] p-2.5 ring-1 ring-white/[.08]">
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-lime/90 text-xs font-bold text-side">{initials}</span>
        <div className="min-w-0 leading-tight">
          <div className="truncate text-sm font-semibold text-white">{user?.name}</div>
          <div className="truncate text-xs text-white/50">{user?.role}{user?.facilities ? ` · ${user.facilities.length} faskes` : ' · semua faskes'}</div>
        </div>
      </div>
      <button className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-semibold text-white/70 ring-1 ring-white/10 transition hover:bg-white/[.07] hover:text-white" onClick={onLogout}>
        <LogOut className="h-3.5 w-3.5" /> Keluar
      </button>
    </div>
  )
}

function Sidebar() {
  const { logout, user } = useApp()
  const groups = navGroupsForUser(user)
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[14.5rem] flex-col bg-side p-3.5 lg:flex" aria-label="Navigasi utama">
      <div className="grain pointer-events-none absolute inset-0 opacity-60" aria-hidden />
      <div className="relative px-1 pb-4 pt-1"><Brand /></div>
      <nav className="scroll-slim no-scrollbar relative flex-1 space-y-4 overflow-y-auto">
        {groups.map((g) => (
          <div key={g.title}>
            <div className="mb-1 px-2.5 text-xs font-medium text-white/40">{g.title}</div>
            <div className="space-y-0.5">
              {g.items.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `group relative flex items-center gap-2.5 rounded-lg px-2.5 py-[.45rem] text-sm font-medium transition-colors ${isActive ? 'text-white' : 'text-white/60 hover:text-white'}`}>
                  {({ isActive }) => (
                    <>
                      {isActive && <motion.span layoutId="side-active" className="absolute inset-0 rounded-lg bg-white/[.09] ring-1 ring-white/10" transition={{ type: 'spring', stiffness: 420, damping: 36 }} />}
                      {isActive && <motion.span layoutId="side-dot" className="absolute -left-3.5 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full bg-lime" transition={{ type: 'spring', stiffness: 420, damping: 36 }} />}
                      <Icon className={`relative h-4 w-4 shrink-0 transition-colors ${isActive ? 'text-lime' : 'group-hover:text-white'}`} />
                      <span className="relative">{label}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="relative mt-3"><UserCard onLogout={logout} /></div>
    </aside>
  )
}

function BottomNav({ onMore }: { onMore: () => void }) {
  const items = NAV_ALL.filter((n) => NAV_MOBILE.includes(n.to))
  return (
    <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-side/95 px-2 pt-1.5 backdrop-blur-xl lg:hidden" aria-label="Navigasi bawah">
      <ul className="mx-auto grid max-w-md grid-cols-5">
        {items.map(({ to, short, icon: Icon }) => (
          <li key={to}>
            <NavLink to={to} end={to === '/'} className={({ isActive }) => `relative flex flex-col items-center gap-0.5 rounded-lg py-1.5 text-2xs font-semibold ${isActive ? 'text-white' : 'text-white/50'}`}>
              {({ isActive }) => (
                <>
                  {isActive && <motion.span layoutId="bn-pill" className="absolute -top-1.5 h-[3px] w-8 rounded-b-full bg-lime" />}
                  <Icon className={`h-5 w-5 ${isActive ? 'text-lime' : ''}`} />
                  {short}
                </>
              )}
            </NavLink>
          </li>
        ))}
        <li>
          <button onClick={onMore} className="flex w-full flex-col items-center gap-0.5 rounded-lg py-1.5 text-2xs font-semibold text-white/50" aria-label="Menu lainnya">
            <Menu className="h-5 w-5" /> Menu
          </button>
        </li>
      </ul>
    </nav>
  )
}

export default function Layout() {
  const { logout, reduced, setReduced, theme, setTheme, run, user } = useApp()
  const loc = useLocation()
  const [pal, setPal] = useState(false)
  const [more, setMore] = useState(false)
  const [stuck, setStuck] = useState(false)
  const { scrollYProgress } = useScroll()
  const prog = useSpring(scrollYProgress, { stiffness: 140, damping: 28 })
  const groups = navGroupsForUser(user)
  const current = navItemsForUser(user).find((n) => (n.to === '/' ? loc.pathname === '/' : loc.pathname === n.to || loc.pathname.startsWith(n.to + '/')))

  useEffect(() => { window.scrollTo({ top: 0 }); setMore(false) }, [loc.pathname])
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPal((v) => !v) } }
    const s = () => setStuck(window.scrollY > 8)
    window.addEventListener('keydown', k); window.addEventListener('scroll', s, { passive: true }); s()
    return () => { window.removeEventListener('keydown', k); window.removeEventListener('scroll', s) }
  }, [])

  return (
    <div className="min-h-dvh">
      <Sidebar />
      <div className="lg:pl-[14.5rem]">
        <header className={`sticky top-0 z-20 transition-[background,box-shadow] duration-200 ${stuck ? 'bg-canvas/85 shadow-[0_1px_0_rgb(var(--line))] backdrop-blur-xl' : 'bg-canvas'}`}>
          <motion.div className="absolute inset-x-0 bottom-0 h-[2px] origin-left bg-brand" style={{ scaleX: prog }} aria-hidden />
          <div className="mx-auto flex h-12 max-w-[88rem] items-center justify-between gap-3 px-4 lg:h-[3.1rem] lg:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <div className="lg:hidden"><span className="grid h-8 w-8 place-items-center rounded-lg bg-side"><PixelMark className="h-4.5 w-4.5" /></span></div>
              <div className="hidden items-center gap-2 text-sm text-muted lg:flex">
                <span>PharmaTrace-AI</span><span className="text-faint">/</span><span className="font-semibold text-ink">{current?.label ?? 'Halaman'}</span>
              </div>
              <div className="flex min-w-0 items-center gap-2">
                <SyntheticBadge label={run?.data_label ?? 'Data Sintetis'} />
                {run
                  ? <span className="hidden truncate text-xs text-muted xl:inline">Run <b className="font-semibold text-ink">{run.id}</b> · {run.summary.records.toLocaleString('id-ID')} klaim · {utcToWib(run.created_at)} WIB</span>
                  : <span className="hidden truncate text-xs text-muted sm:inline">Belum ada audit</span>}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button className="btn-ghost btn-sm hidden gap-2 !pl-2.5 !pr-1.5 text-muted sm:inline-flex" onClick={() => setPal(true)} aria-label="Buka pencarian cepat">
                Cari cepat <kbd className="flex items-center gap-0.5 rounded bg-sunken px-1.5 py-0.5 text-2xs"><Command className="h-2.5 w-2.5" />K</kbd>
              </button>
              <button className="btn-ghost btn-sm !px-2" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={theme === 'dark' ? 'Tema terang' : 'Tema gelap'} title={theme === 'dark' ? 'Tema terang' : 'Tema gelap'}>
                {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
              </button>
              <button className={`btn-ghost btn-sm !px-2 ${reduced ? 'text-warn' : ''}`} onClick={() => setReduced(!reduced)} aria-pressed={reduced} title="Kurangi animasi dan visual 3D untuk perangkat lemah" aria-label="Kurangi animasi dan 3D">
                {reduced ? <ZapOff className="h-3.5 w-3.5" /> : <Zap className="h-3.5 w-3.5 text-brand" />}
                <span className="hidden md:inline">{reduced ? 'Mode ringan' : 'Animasi'}</span>
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[88rem] px-4 pb-28 pt-3 lg:px-6 lg:pb-12 lg:pt-4">
          <motion.div key={loc.pathname} initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}>
            <Outlet />
          </motion.div>
        </main>
      </div>

      <BottomNav onMore={() => setMore(true)} />
      <Sheet open={more} onClose={() => setMore(false)} title="Menu">
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.title}>
              <div className="mb-1.5 text-xs font-medium text-muted">{g.title}</div>
              <div className="grid gap-1.5">
                {g.items.map(({ to, label, icon: Icon, hint }) => (
                  <NavLink key={to} to={to} end={to === '/'} onClick={() => setMore(false)} className={({ isActive }) => `flex items-center gap-3 rounded-xl p-2.5 ring-1 ring-inset transition ${isActive ? 'bg-brand/10 ring-brand/30' : 'bg-surface ring-line'}`}>
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-sunken text-brand"><Icon className="h-4 w-4" /></span>
                    <span className="min-w-0"><span className="block text-sm font-semibold">{label}</span><span className="block truncate text-xs text-muted">{hint}</span></span>
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
          <div className="rounded-xl bg-side p-0.5"><UserCard onLogout={logout} /></div>
        </div>
      </Sheet>
      <CommandPalette open={pal} onClose={() => setPal(false)} />
    </div>
  )
}
