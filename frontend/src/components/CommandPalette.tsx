import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { CornerDownLeft, LogOut, Moon, Play, Search, Sun, Zap } from 'lucide-react'
import { canRun, useApp } from '../lib/app'
import { navItemsForUser } from './nav'

interface Cmd { id: string; label: string; hint?: string; icon: any; run: () => void }

export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const nav = useNavigate()
  const { theme, setTheme, reduced, setReduced, logout, user } = useApp()
  const navItems = navItemsForUser(user)
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  const cmds = useMemo<Cmd[]>(() => [
    ...navItems.map((n) => ({ id: n.to, label: n.label, hint: n.hint, icon: n.icon, run: () => nav(n.to) })),
    ...(canRun(user) ? [{ id: 'demo', label: 'Muat skenario demo', hint: 'Jalankan audit 10.000 record dengan kasus unggulan', icon: Play, run: () => nav('/audit?auto=demo') }] : []),
    { id: 'theme', label: theme === 'dark' ? 'Ganti ke tema terang' : 'Ganti ke tema gelap', icon: theme === 'dark' ? Sun : Moon, run: () => setTheme(theme === 'dark' ? 'light' : 'dark') },
    { id: 'motion', label: reduced ? 'Aktifkan animasi dan 3D' : 'Kurangi animasi dan 3D', icon: Zap, run: () => setReduced(!reduced) },
    { id: 'logout', label: 'Keluar', icon: LogOut, run: logout },
  ], [nav, navItems, theme, reduced, user, logout, setTheme, setReduced])

  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? cmds.filter((c) => (c.label + ' ' + (c.hint ?? '')).toLowerCase().includes(s)) : cmds
  }, [q, cmds])

  useEffect(() => { if (open) { setQ(''); setI(0); setTimeout(() => input.current?.focus(), 30) } }, [open])
  useEffect(() => setI(0), [q])

  const exec = (c?: Cmd) => { if (!c) return; onClose(); c.run() }
  const key = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setI((v) => Math.min(list.length - 1, v + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setI((v) => Math.max(0, v - 1)) }
    else if (e.key === 'Enter') exec(list[i])
    else if (e.key === 'Escape') onClose()
  }

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh]" role="dialog" aria-modal="true" aria-label="Palet perintah">
          <motion.div className="absolute inset-0 bg-side/60 backdrop-blur-[3px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div className="panel relative w-full max-w-lg overflow-hidden shadow-pop" initial={{ opacity: 0, y: -12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8 }} transition={{ type: 'spring', stiffness: 420, damping: 32 }}>
            <div className="flex items-center gap-2.5 border-b border-line px-3.5">
              <Search className="h-4 w-4 text-faint" />
              <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={key} placeholder="Cari halaman atau aksi" className="h-11 w-full bg-transparent text-base outline-none focus-visible:outline-none placeholder:text-faint" aria-label="Cari" />
              <kbd className="rounded-md bg-sunken px-1.5 py-0.5 text-2xs text-muted">Esc</kbd>
            </div>
            <ul className="scroll-slim max-h-[50vh] overflow-y-auto p-1.5">
              {list.map((c, idx) => (
                <li key={c.id}>
                  <button onMouseMove={() => setI(idx)} onClick={() => exec(c)} className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${idx === i ? 'bg-brand/10' : ''}`}>
                    <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${idx === i ? 'bg-brand text-onbrand' : 'bg-sunken text-muted'}`}><c.icon className="h-3.5 w-3.5" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{c.label}</span>
                      {c.hint && <span className="block truncate text-xs text-muted">{c.hint}</span>}
                    </span>
                    {idx === i && <CornerDownLeft className="h-3.5 w-3.5 text-brand" />}
                  </button>
                </li>
              ))}
              {list.length === 0 && <li className="px-3 py-8 text-center text-sm text-muted">Tidak ada hasil untuk “{q}”.</li>}
            </ul>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
