import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform } from 'framer-motion'
import { Download, Info, AlertTriangle, CircleAlert, X } from 'lucide-react'
import { exportChartPng } from '../lib/export'
import { useCountUp } from '../lib/hooks'
import { useApp } from '../lib/app'

/* ───────────────────────── Identitas ───────────────────────── */
export function PixelMark({ className = '' }: { className?: string }) {
  const sq = [[0, 0, '#99CC44'], [10, 0, '#99CC44'], [20, 0, '#2DD4A7'], [0, 10, '#2DD4A7'], [10, 10, '#99CC44'], [10, 20, '#2DD4A7'], [20, 20, '#99CC44']] as const
  return (
    <svg viewBox="0 0 30 30" className={className} aria-hidden>
      {sq.map(([x, y, c], i) => <rect key={i} x={x} y={y} width="9" height="9" rx="2.4" fill={c} />)}
    </svg>
  )
}

export const SyntheticBadge = ({ label = 'Data Sintetis' }: { label?: string }) => (
  <span className="chip chip-ok"><span className="h-1.5 w-1.5 rounded-full bg-brand" />{label}</span>
)

/* ───────────────────────── Struktur halaman ───────────────────────── */
export function PageHeader({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 lg:mb-6">
      <div className="min-w-0 max-w-3xl">
        <h1 className="font-display text-2xl font-bold tracking-tight text-ink lg:text-3xl" style={{ fontVariationSettings: "'wdth' 90" }}>{title}</h1>
        {subtitle && <p className="mt-1 text-sm leading-relaxed text-muted">{subtitle}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  )
}

export function Section({ title, hint, right, children, className = '' }: { title: string; hint?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={className}>
      <div className="mb-2.5 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold tracking-tight text-ink">{title}</h2>
          {hint && <p className="text-xs text-muted">{hint}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  )
}
/** Kompatibel dengan nama lama. */
export const SectionTitle = Section as unknown as (p: { title: string; hint?: ReactNode; right?: ReactNode }) => JSX.Element

export function Panel({ title, hint, right, children, className = '', pad = true }: { title?: string; hint?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`panel ${className}`}>
      {title && (
        <div className="flex items-start justify-between gap-3 px-4 pt-3.5">
          <div className="min-w-0">
            <h3 className="font-display text-base font-semibold tracking-tight text-ink">{title}</h3>
            {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
          </div>
          {right}
        </div>
      )}
      <div className={pad ? 'p-4' : ''}>{children}</div>
    </section>
  )
}

/* ───────────────────────── Angka kunci ───────────────────────── */
const TONE = {
  brand: { text: 'text-brand', chip: 'bg-brand/10 text-brand' },
  risk: { text: 'text-risk', chip: 'bg-risk/10 text-risk' },
  warn: { text: 'text-warn', chip: 'bg-warn/10 text-warn' },
  info: { text: 'text-info', chip: 'bg-info/10 text-info' },
  ink: { text: 'text-ink', chip: 'bg-sunken text-muted' },
} as const
export type Tone = keyof typeof TONE
/** Nama lama (lime/teal/danger/amber/blue) dipetakan ke token baru. */
const ALIAS: Record<string, Tone> = { lime: 'brand', teal: 'brand', danger: 'risk', amber: 'warn', blue: 'info' }

export function StatGrid({ children, cols = 'grid-cols-2 lg:grid-cols-5', className = '' }: { children: ReactNode; cols?: string; className?: string }) {
  // gap-px di atas latar garis = pemisah tipis tanpa membuat tiap angka jadi kartu sendiri
  return <div className={`grid gap-px overflow-hidden rounded-2xl bg-line/80 shadow-lift ring-1 ring-line/80 ${cols} ${className}`}>{children}</div>
}

export function Stat({ label, value, sub, tone = 'ink', icon, count, fmt, className = '' }: { label: string; value?: ReactNode; sub?: ReactNode; tone?: Tone | 'lime' | 'teal' | 'danger' | 'amber' | 'blue'; icon?: ReactNode; count?: number | null; fmt?: (n: number) => string; className?: string }) {
  const { reduced } = useApp()
  const t = TONE[(ALIAS[tone] ?? tone) as Tone]
  const n = useCountUp(count, 1000, reduced)
  const shown = count !== undefined && count !== null ? (fmt ? fmt(n) : Math.round(n).toLocaleString('id-ID')) : value
  return (
    <div className={`bg-surface p-3.5 lg:p-4 ${className}`}>
      <div className="flex items-center gap-2 text-xs font-medium text-muted">
        {icon && <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full [&>svg]:h-3.5 [&>svg]:w-3.5 ${t.chip}`}>{icon}</span>}
        <span className="truncate">{label}</span>
      </div>
      <div className={`mt-2 truncate font-num text-2xl font-bold lg:text-3xl ${t.text}`}>{shown}</div>
      {sub && <div className="mt-1 text-xs leading-snug text-muted">{sub}</div>}
    </div>
  )
}

/* ───────────────────────── Umpan balik ───────────────────────── */
export function Alert({ kind = 'info', title, children }: { kind?: 'info' | 'warn' | 'error'; title?: string; children?: ReactNode }) {
  const style = { info: 'bg-info/8 text-ink ring-info/25', warn: 'bg-warn/10 text-ink ring-warn/30', error: 'bg-risk/8 text-ink ring-risk/30' }[kind]
  const iconColor = { info: 'text-info', warn: 'text-warn', error: 'text-risk' }[kind]
  const Icon = kind === 'info' ? Info : kind === 'warn' ? AlertTriangle : CircleAlert
  return (
    <div className={`flex gap-3 rounded-xl p-3.5 text-sm ring-1 ring-inset ${style}`} role={kind === 'error' ? 'alert' : undefined}>
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${iconColor}`} />
      <div className="min-w-0">
        {title && <div className="font-semibold">{title}</div>}
        <div className="text-xs leading-relaxed text-muted">{children}</div>
      </div>
    </div>
  )
}

export function Empty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="panel grid place-items-center px-6 py-14 text-center">
      <div className="relative mb-4">
        <span className="absolute inset-0 animate-pulseRing rounded-full bg-brand/20" aria-hidden />
        <span className="relative grid h-14 w-14 place-items-center rounded-2xl bg-side shadow-pop"><PixelMark className="h-7 w-7" /></span>
      </div>
      <div className="font-display text-lg font-semibold">{title}</div>
      {hint && <p className="mt-1 max-w-sm text-sm leading-relaxed text-muted">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Loading({ text = 'Memuat…' }: { text?: string }) {
  return (
    <div className="panel space-y-3 p-5" role="status" aria-label={text}>
      <div className="skeleton h-5 w-1/3" /><div className="skeleton h-24 w-full" /><div className="skeleton h-4 w-2/3" />
      <span className="sr-only">{text}</span>
    </div>
  )
}

export function ChartCard({ title, sub, children, png, className = '' }: { title: string; sub?: string; children: ReactNode; png?: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div className={`panel flex flex-col p-4 ${className}`}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-display text-base font-semibold tracking-tight">{title}</div>
          {sub && <div className="mt-0.5 text-xs leading-snug text-muted">{sub}</div>}
        </div>
        {png && (
          <button className="btn-ghost btn-sm shrink-0" onClick={() => exportChartPng(ref.current, title, `${png}.png`)} title="Ekspor grafik ke PNG" aria-label={`Ekspor ${title} ke PNG`}>
            <Download className="h-3.5 w-3.5" /> PNG
          </button>
        )}
      </div>
      <div ref={ref} className="min-h-0 flex-1">{children}</div>
    </div>
  )
}

export function Meter({ value, max = 100, color = 'rgb(var(--brand))', h = 'h-1.5' }: { value: number; max?: number; color?: string; h?: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className={`${h} overflow-hidden rounded-full bg-sunken`} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <motion.div className="h-full rounded-full" style={{ background: color }} initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ type: 'spring', stiffness: 90, damping: 20 }} />
    </div>
  )
}

/* ───────────────────────── Gauge Discrepancy Index ───────────────────────── */
export function DiGauge({ value, size = 104 }: { value: number; size?: number }) {
  const { reduced } = useApp()
  const id = useId()
  const r = size / 2 - 9
  const circ = 2 * Math.PI * r
  const tone = value >= 70 ? 'risk' : value >= 40 ? 'warn' : 'brand'
  const n = useCountUp(value, 900, reduced)
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={`rgb(var(--${tone}))`} stopOpacity=".55" />
            <stop offset="1" stopColor={`rgb(var(--${tone}))`} />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgb(var(--sunken))" strokeWidth="9" fill="none" />
        {Array.from({ length: 40 }).map((_, i) => {
          const a = (i / 40) * Math.PI * 2
          return <line key={i} x1={size / 2 + Math.cos(a) * (r + 7)} y1={size / 2 + Math.sin(a) * (r + 7)} x2={size / 2 + Math.cos(a) * (r + 9)} y2={size / 2 + Math.sin(a) * (r + 9)} stroke="rgb(var(--line))" strokeWidth="1" />
        })}
        <motion.circle cx={size / 2} cy={size / 2} r={r} stroke={`url(#${id})`} strokeWidth="9" fill="none" strokeLinecap="round" strokeDasharray={circ} initial={{ strokeDashoffset: circ }} animate={{ strokeDashoffset: circ * (1 - value / 100) }} transition={{ duration: reduced ? 0 : 1, ease: [0.2, 0.8, 0.2, 1] }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="text-center leading-none">
          <div className="font-num text-3xl font-bold" style={{ color: `rgb(var(--${tone}))` }}>{Math.round(n)}</div>
          <div className="mt-1 text-2xs font-medium text-muted">DI dari 100</div>
        </div>
      </div>
    </div>
  )
}

/* ───────────────────────── Kontrol ───────────────────────── */
export function Tabs<T extends string>({ value, onChange, items, className = '' }: { value: T; onChange: (v: T) => void; items: { id: T; label: ReactNode }[]; className?: string }) {
  const gid = useId()
  return (
    <div className={`flex gap-1 rounded-xl bg-sunken p-1 ${className}`} role="tablist">
      {items.map((it) => (
        <button key={it.id} role="tab" aria-selected={value === it.id} onClick={() => onChange(it.id)} className={`relative flex-1 rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${value === it.id ? 'text-ink' : 'text-muted hover:text-ink'}`}>
          {value === it.id && <motion.span layoutId={`tab-${gid}`} className="absolute inset-0 rounded-lg bg-surface shadow-lift ring-1 ring-line" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
          <span className="relative">{it.label}</span>
        </button>
      ))}
    </div>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-ink/80">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-xs leading-snug text-faint">{hint}</span>}
    </label>
  )
}

/** Panel geser: bottom sheet di ponsel, panel samping di layar lebar. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', k)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', k); document.body.style.overflow = prev }
  }, [open, onClose])
  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-stretch sm:justify-end" role="dialog" aria-modal="true">
          <motion.div className="absolute inset-0 bg-side/60 backdrop-blur-[3px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
          <motion.div
            className="relative flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-3xl bg-canvas shadow-pop ring-1 ring-line sm:max-h-none sm:w-[26rem] sm:rounded-none sm:rounded-l-3xl"
            initial={{ y: 60, x: 0, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 60, opacity: 0 }} transition={{ type: 'spring', stiffness: 380, damping: 36 }}
            drag="y" dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.5 }} onDragEnd={(_, i) => { if (i.offset.y > 90) onClose() }}
          >
            <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line sm:hidden" />
            <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-3">
              <div className="font-display text-lg font-semibold">{title}</div>
              <button className="btn-ghost btn-sm !px-2" onClick={onClose} aria-label="Tutup"><X className="h-4 w-4" /></button>
            </div>
            <div className="scroll-slim min-h-0 flex-1 overflow-y-auto px-4 pb-6">{children}</div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}

/** Kartu miring 3D mengikuti kursor (mati bila "kurangi animasi"). */
export function Tilt({ children, className = '', max = 7 }: { children: ReactNode; className?: string; max?: number }) {
  const { reduced } = useApp()
  const x = useMotionValue(0.5)
  const y = useMotionValue(0.5)
  const sx = useSpring(x, { stiffness: 200, damping: 20 })
  const sy = useSpring(y, { stiffness: 200, damping: 20 })
  const rx = useTransform(sy, [0, 1], [max, -max])
  const ry = useTransform(sx, [0, 1], [-max, max])
  const gx = useTransform(sx, (v) => `${v * 100}%`)
  const gy = useTransform(sy, (v) => `${v * 100}%`)
  if (reduced) return <div className={className}>{children}</div>
  return (
    <div style={{ perspective: 900 }} className="h-full">
      <motion.div
        className={`relative h-full ${className}`}
        style={{ rotateX: rx, rotateY: ry, transformStyle: 'preserve-3d' }}
        onPointerMove={(e) => { if (e.pointerType !== 'mouse') return; const b = e.currentTarget.getBoundingClientRect(); x.set((e.clientX - b.left) / b.width); y.set((e.clientY - b.top) / b.height) }}
        onPointerLeave={() => { x.set(0.5); y.set(0.5) }}
      >
        {children}
        <motion.span aria-hidden className="pointer-events-none absolute inset-0 rounded-[inherit] opacity-0 transition-opacity duration-200 [div:hover>&]:opacity-100" style={{ background: useTransform([gx, gy], ([a, b]) => `radial-gradient(240px circle at ${a} ${b}, rgb(255 255 255 / .16), transparent 60%)`) as any }} />
      </motion.div>
    </div>
  )
}

/** Varian masuk berurutan: dipakai sekali per halaman, bukan per kartu. */
export const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.06, delayChildren: 0.05 } } }
export const rise = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 260, damping: 28 } } }

export function useReveal() {
  const [shown, setShown] = useState(false)
  useEffect(() => { const t = requestAnimationFrame(() => setShown(true)); return () => cancelAnimationFrame(t) }, [])
  return shown
}
