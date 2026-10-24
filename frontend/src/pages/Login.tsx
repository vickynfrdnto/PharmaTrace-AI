import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ArrowRight,
  Eye,
  EyeOff,
  Loader2,
  Moon,
  ShieldCheck,
  Sun,
  UserCog,
  UserRoundCheck,
  Users,
} from 'lucide-react'
import { api } from '../lib/api'
import { useApp } from '../lib/app'
import { Alert, PixelMark, SyntheticBadge, Tilt, rise, stagger } from '../components/ui'
import Stage from '../components/Stage'

/* ------------------------------------------------------------------ */
/* Konstanta                                                           */
/* ------------------------------------------------------------------ */

const ROLE_ICON: Record<string, any> = {
  Verifikator: UserRoundCheck,
  Supervisor: Users,
  Admin: UserCog,
}

const ROLE_NOTE: Record<string, string> = {
  Verifikator: 'Meninjau klaim ter-flag dan memutuskan',
  Supervisor: 'Menjalankan audit dan mengawasi sampel acak',
  Admin: 'Akses penuh termasuk audit trail',
}

const INPUT_CLASS =
  'w-full rounded-xl border border-line bg-surface/50 px-3.5 py-2.5 text-sm text-ink transition-all placeholder:text-muted focus:border-brand focus:bg-background focus:outline-none focus:ring-4 focus:ring-brand/10'

/* ------------------------------------------------------------------ */
/* Sub-komponen                                                        */
/* ------------------------------------------------------------------ */

/** Panel kiri: merek + Stage 3D (hanya tampil di layar besar). */
function BrandPanel() {
  return (
    <div className="relative hidden overflow-hidden bg-black/95 lg:block">
      <Stage
        className="!absolute inset-0 !rounded-none !shadow-none !ring-0 scale-105 transition-transform duration-[10s] hover:scale-100"
        anomRate={0.15}
        running={false}
        progress={0}
      />
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-background via-transparent to-background/90" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-brand/10 via-transparent to-transparent opacity-50" />

      <div className="relative z-10 flex h-full flex-col justify-between p-12">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className="flex items-center gap-4"
        >
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-white/5 ring-1 ring-white/20 backdrop-blur-xl shadow-[0_0_30px_rgba(255,255,255,0.1)]">
            <PixelMark className="h-7 w-7 text-white" />
          </span>
          <div className="font-display text-2xl font-bold tracking-wide text-white">
            Pharma
            <span className="text-lime-400 drop-shadow-[0_0_10px_rgba(163,230,53,0.5)]">Trace</span>
            -AI
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2, ease: 'easeOut' }}
          className="max-w-lg"
        >
          <h1
            className="font-display text-5xl font-extrabold leading-[1.1] text-transparent bg-clip-text bg-gradient-to-br from-white to-white/60 drop-shadow-sm"
            style={{ fontVariationSettings: "'wdth' 88" }}
          >
            Selisih obat terlihat sebelum klaim dibayar.
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-white/70 font-light">
            Engine audit triangulasi untuk klaim obat dan alat kesehatan. AI memberi prioritas,
            bukti, dan alasan.{' '}
            <strong className="text-white font-medium">
              Keputusan akhir ada pada verifikator manusia.
            </strong>
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <SyntheticBadge />
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-sm font-medium text-white/80 backdrop-blur-md shadow-inner">
              <span className="h-2 w-2 rounded-full bg-lime-400 animate-pulse" />
              tanpa data peserta JKN riil
            </span>
          </div>
        </motion.div>
      </div>
    </div>
  )
}

/** Tombol satu akun demo. */
function DemoUserButton({
  user,
  busy,
  onSelect,
}: {
  user: any
  busy: string | null
  onSelect: () => void
}) {
  const Icon = ROLE_ICON[user.role] ?? ShieldCheck
  const note = `${ROLE_NOTE[user.role] ?? ''}${user.facilities ? ` (${user.facilities.length} faskes)` : ''}`

  return (
    <Tilt max={2} className="rounded-xl">
      <button
        disabled={!!busy}
        onClick={onSelect}
        className="group relative flex w-full items-center gap-3 overflow-hidden rounded-xl border border-line bg-surface/50 p-2.5 text-left transition-all duration-300 hover:border-brand/50 hover:bg-brand/5 hover:shadow-[0_8px_20px_rgb(0,0,0,0.1)] disabled:opacity-60"
      >
        <div className="absolute inset-0 bg-gradient-to-r from-brand/0 via-brand/5 to-brand/0 opacity-0 transition-opacity duration-500 group-hover:opacity-100" />

        <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-sunken text-brand shadow-inner transition-transform duration-300 group-hover:scale-105 group-hover:bg-brand group-hover:text-onbrand">
          <Icon className="h-4 w-4" />
        </span>

        <span className="relative min-w-0 flex-1">
          <span className="block text-sm font-bold text-ink">
            {user.role} <span className="font-normal text-muted">· {user.name}</span>
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-muted">{note}</span>
        </span>

        {busy === user.username ? (
          <Loader2 className="relative h-4 w-4 shrink-0 animate-spin text-brand" />
        ) : (
          <ArrowRight className="relative h-4 w-4 shrink-0 text-faint transition-all duration-300 group-hover:translate-x-0.5 group-hover:text-brand" />
        )}
      </button>
    </Tilt>
  )
}

/* ------------------------------------------------------------------ */
/* Halaman Login                                                       */
/* ------------------------------------------------------------------ */

export default function Login() {
  const { login, theme, setTheme, reduced } = useApp()

  const [users, setUsers] = useState<any[] | null>(null)
  const [usersErr, setUsersErr] = useState('')
  const [u, setU] = useState('')
  const [p, setP] = useState('')
  const [show, setShow] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    api('/auth/demo-users')
      .then(setUsers)
      .catch(() => {
        setUsers([])
        setUsersErr('Pilihan akun demo tidak dapat dimuat. Coba muat ulang atau masuk secara manual.')
      })
  }, [])

  const go = async (user: string, pass: string, key = 'manual') => {
    setBusy(key)
    setErr('')
    try {
      await login(user, pass)
    } catch (e) {
      setErr((e as Error).message)
    }
    setBusy(null)
  }

  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark')

  return (
    <div className="grid min-h-dvh bg-background lg:grid-cols-[1.1fr_1fr] overflow-hidden selection:bg-brand/30">
      <BrandPanel />

      {/* Form kaca (glassmorphism) */}
      <div className="relative flex items-center justify-center px-5 py-6 sm:px-8">
        {/* Glow ambient di belakang form untuk mobile */}
        <div className="pointer-events-none absolute top-1/2 left-1/2 h-3/4 w-3/4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand/20 blur-[120px] lg:hidden" />

        <button
          className="absolute right-5 top-5 rounded-full border border-white/10 bg-white/5 p-2 text-muted backdrop-blur-md transition-all hover:scale-105 hover:bg-white/10 hover:text-ink focus:outline-none focus:ring-2 focus:ring-brand/50"
          onClick={toggleTheme}
          aria-label="Ganti tema"
        >
          {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>

        <motion.div
          variants={stagger}
          initial={reduced ? false : 'hidden'}
          animate="show"
          className="relative z-10 w-full max-w-[380px] sm:rounded-2xl sm:border sm:border-white/10 sm:bg-white/5 sm:p-7 sm:shadow-2xl sm:backdrop-blur-2xl"
        >
          {/* Logo (mobile) */}
          <motion.div variants={rise} className="mb-5 flex items-center gap-3 lg:hidden">
            <span className="grid h-10 w-10 place-items-center rounded-xl border border-brand/20 bg-gradient-to-br from-brand/20 to-brand/5 shadow-[0_0_20px_rgba(var(--brand),0.2)]">
              <PixelMark className="h-6 w-6 text-brand" />
            </span>
            <div>
              <div className="font-display text-xl font-bold">
                Pharma<span className="text-brand">Trace</span>-AI
              </div>
              <div className="text-xs font-medium text-brand/70">DeveloperDay 2026</div>
            </div>
          </motion.div>

          {/* Judul */}
          <motion.div variants={rise}>
            <h2 className="font-display text-2xl font-bold tracking-tight text-ink">
              Masuk ke ruang audit
            </h2>
            <p className="mt-1 text-xs text-muted">
              Pilih peran demo untuk menjelajahi kapabilitas platform.
            </p>
            <p className="mt-2.5 rounded-xl border border-warn/30 bg-warn/10 px-3 py-2 text-[11px] leading-relaxed text-muted">
              Prototipe ini memakai data sintetis. Jangan unggah data pasien, peserta JKN, tenaga
              kesehatan, atau fasilitas yang nyata.
            </p>
          </motion.div>

          {/* Akun demo */}
          <motion.div variants={rise} className="mt-4 space-y-2">
            {usersErr && (
              <Alert kind="warn" title="Akun demo tidak tersedia">
                {usersErr}
              </Alert>
            )}

            {users === null &&
              [0, 1, 2].map((i) => (
                <div key={i} className="h-14 w-full animate-pulse rounded-xl bg-muted/20" />
              ))}

            {users?.map((x) => (
              <DemoUserButton
                key={x.username}
                user={x}
                busy={busy}
                onSelect={() => go(x.username, x.password, x.username)}
              />
            ))}
          </motion.div>

          {/* Pemisah */}
          <motion.div
            variants={rise}
            className="my-4 flex items-center gap-3 text-[11px] font-medium uppercase tracking-widest text-faint"
          >
            <span className="h-px flex-1 bg-gradient-to-r from-transparent to-line" />
            Atau masuk manual
            <span className="h-px flex-1 bg-gradient-to-l from-transparent to-line" />
          </motion.div>

          {/* Form manual */}
          <motion.form
            variants={rise}
            className="space-y-2.5"
            onSubmit={(e) => {
              e.preventDefault()
              go(u, p)
            }}
          >
            <input
              className={INPUT_CLASS}
              placeholder="Nama pengguna"
              aria-label="Nama pengguna"
              autoComplete="username"
              value={u}
              onChange={(e) => setU(e.target.value)}
            />

            <div className="relative">
              <input
                className={`${INPUT_CLASS} pr-10`}
                placeholder="Kata sandi"
                aria-label="Kata sandi"
                type={show ? 'text' : 'password'}
                autoComplete="current-password"
                value={p}
                onChange={(e) => setP(e.target.value)}
              />
              <button
                type="button"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1.5 text-faint transition-colors hover:bg-line/50 hover:text-ink focus:outline-none focus:ring-2 focus:ring-brand/50"
                onClick={() => setShow(!show)}
                aria-label={show ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}
              >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>

            <button
              type="submit"
              className="mt-1 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-brand px-4 py-2.5 text-sm font-bold text-onbrand shadow-[0_4px_20px_rgba(var(--brand),0.3)] transition-all hover:-translate-y-0.5 hover:brightness-110 hover:shadow-[0_6px_25px_rgba(var(--brand),0.45)] active:translate-y-0 disabled:pointer-events-none disabled:opacity-50"
              disabled={!!busy || !u}
            >
              {busy === 'manual' && <Loader2 className="h-4 w-4 animate-spin" />}
              <span>Akses Ruang Audit</span>
              {busy !== 'manual' && <ArrowRight className="h-4 w-4" />}
            </button>
          </motion.form>

          {/* Error login */}
          <AnimatePresence>
            {err && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="mt-3"
              >
                <Alert kind="error" title="Tidak dapat masuk">
                  {err}
                </Alert>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  )
}