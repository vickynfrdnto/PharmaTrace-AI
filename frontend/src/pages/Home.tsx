import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowRight, CheckCircle2, Coins, FileText, Flag, Grid3x3, Hourglass, Play, Search, Timer, UploadCloud, BarChart3 } from 'lucide-react'
import Stage from '../components/Stage'
import { Alert, Meter, Panel, Section, Stat, StatGrid, Tilt, stagger, rise } from '../components/ui'
import { canRun, useApp } from '../lib/app'
import { num, rp, secs } from '../lib/format'

const pct1 = (v: number) => v.toFixed(1).replace('.', ',')

export default function HomePage() {
  const { run, user, reduced } = useApp()
  const [fps, setFps] = useState<number | null>(null)
  const [burst, setBurst] = useState(0)
  const lastRun = useRef<string | null>(null)
  const s = run?.summary
  const counts = run?.meta?.actual ? { p: run.meta.actual.procurement, r: run.meta.actual.rme_medication_administration, c: run.meta.actual.claims } : s ? { p: undefined, r: undefined, c: s.records } : undefined
  const stages = s ? Object.entries(s.stage_seconds as Record<string, number>).sort((a, b) => b[1] - a[1]).slice(0, 6) : []
  const totalStage = stages.reduce((a, [, v]) => a + v, 0)

  // gelombang kejut di scene ketika data run baru tiba
  useEffect(() => {
    if (run?.id && lastRun.current && lastRun.current !== run.id) setBurst((b) => b + 1)
    lastRun.current = run?.id ?? null
  }, [run?.id])

  const doors = [
    { c: '#4C9AFF', t: 'Pintu 1 · Procurement', d: 'Faktur e-Katalog / ERP', n: counts?.p },
    { c: '#2DD4A7', t: 'Pintu 2 · RME', d: 'Pemberian obat (FHIR-like)', n: counts?.r },
    { c: '#FFB020', t: 'Pintu 3 · Klaim VEDIKA', d: 'Klaim obat dan alkes', n: counts?.c },
  ]
  const steps = [
    { to: '/audit', icon: UploadCloud, t: 'Muat data dan jalankan audit', d: 'Tiga pintu data masuk ke engine rekonsiliasi.', done: !!run },
    { to: '/heatmap', icon: Grid3x3, t: 'Cari sel yang menyimpang', d: 'Selisih pengadaan vs klaim per faskes dan kategori.', done: false },
    { to: '/inspector', icon: Search, t: 'Tinjau klaim ter-flag', d: 'Baca alasan, buktikan, lalu putuskan.', done: false },
    ...(canRun(user) ? [{ to: '/evaluasi', icon: BarChart3, t: 'Uji kinerja model', d: 'Precision, recall, dan batas yang jujur.', done: false }] : []),
  ]

  return (
    <motion.div variants={stagger} initial={reduced ? false : 'hidden'} animate="show" className="space-y-5 lg:space-y-6">
      {/* ───────── Hero ───────── */}
      <motion.section variants={rise} aria-label="Ringkasan produk" className="grid gap-4 xl:grid-cols-[21rem_1fr] xl:gap-6">
        <div className="flex flex-col justify-center py-1 xl:pr-2">
          <span className="chip chip-ok w-fit">Detect Smarter, Protect JKN</span>
          <h1 className="mt-3 font-display text-3xl font-bold leading-[1.05] tracking-tight lg:text-[2.6rem]" style={{ fontVariationSettings: "'wdth' 88" }}>
            Audit triangulasi sebelum klaim dibayar
          </h1>
          <p className="mt-3 max-w-md text-base leading-relaxed text-muted">
            Cocokkan pengadaan, rekam medis, dan klaim dalam satu proses. AI memberi prioritas dan alasan; keputusan akhir tetap di tangan verifikator.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {canRun(user) && <Link to="/audit?auto=demo" className="btn-primary"><Play className="h-4 w-4" /> Muat skenario demo</Link>}
            <Link to="/audit" className="btn-ghost"><UploadCloud className="h-4 w-4" /> Upload &amp; Audit</Link>
          </div>
          <ul className="mt-5 hidden space-y-1.5 xl:block">
            {doors.map((d) => (
              <li key={d.t} className="flex items-center gap-2.5 text-sm">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: d.c, boxShadow: `0 0 0 3px ${d.c}22` }} />
                <span className="font-semibold">{d.t}</span>
                <span className="ml-auto tnum text-xs text-muted">{d.n !== undefined ? num(d.n) : ''}</span>
              </li>
            ))}
          </ul>
        </div>

        <Stage className="h-[21rem] sm:h-[25rem] xl:h-[29rem]" counts={counts} flagged={s?.flagged} total={s?.records} anomRate={s ? s.flagged_pct / 100 : 0.15} running={false} progress={0} burst={burst} onFps={setFps}>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 bg-gradient-to-t from-stage via-stage/80 to-transparent px-4 pb-3 pt-8 text-xs text-white/60">
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full bg-[#FF6B5E] shadow-[0_0_10px_#FF6B5E]" />
              {s ? `Partikel merah: ${pct1(s.flagged_pct as number)}% klaim ter-flag` : 'Ilustrasi: sekitar 15% partikel merah sebelum ada audit'}
            </span>
            <span className="hidden items-center gap-2 sm:flex">
              Klik node untuk membuka{!reduced && fps !== null && <span className="chip bg-white/10 text-white/70 ring-white/10 tnum">{fps} FPS</span>}
            </span>
          </div>
        </Stage>
      </motion.section>

      {/* ───────── Angka kunci ───────── */}
      <motion.section variants={rise} aria-label="Ringkasan hasil audit">
        <StatGrid cols="grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
          <Stat icon={<FileText />} label="Klaim diproses" count={s?.records ?? null} value="—" sub={s ? `${s.facilities} fasilitas kesehatan` : 'belum ada audit'} />
          <Stat icon={<Flag />} tone="risk" label="Klaim ter-flag" count={s?.flagged ?? null} value="—" sub={s ? `${pct1(s.flagged_pct as number)}% dari total · ${num(s.high_priority)} prioritas tinggi` : undefined} />
          <Stat icon={<Coins />} tone="warn" label="Potensi selisih" value={s ? rp(s.potential_difference) : '—'} sub="estimasi dari klaim ter-flag, bukan hasil final" />
          <Stat icon={<Hourglass />} tone="info" label="Menunggu faktur" count={s?.waiting_invoice ?? null} value="—" sub={s ? `tertahan ${rp(s.held_value)} · bukan penolakan` : 'masa tenggang 14 hari'} />
          <Stat icon={<Timer />} tone="brand" label="Waktu proses" value={secs(s?.process_seconds)} sub="pseudonimisasi + analitik, terukur" className="col-span-2 md:col-span-1" />
        </StatGrid>
        <p className="mt-2 px-1 text-xs text-muted">{s ? <>Run <span className="font-semibold text-ink">{run.id}</span>, diperbarui dari audit terakhir.</> : 'Belum ada audit yang dijalankan.'}</p>
      </motion.section>

      {/* ───────── Langkah + waktu per tahap ───────── */}
      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <motion.div variants={rise}>
          <Section title="Alur kerja" hint="Urutan yang disarankan untuk satu siklus audit">
            <ol className="grid gap-3 sm:grid-cols-2">
              {steps.map((st, i) => (
                <li key={st.to}>
                  <Tilt className="h-full rounded-2xl" max={5}>
                    <Link to={st.to} className="panel group flex h-full gap-3 p-3.5 transition-shadow hover:shadow-pop">
                      <span className="relative grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-sunken text-brand transition group-hover:bg-brand group-hover:text-onbrand">
                        <st.icon className="h-4 w-4" />
                        {st.done && <CheckCircle2 className="absolute -right-1.5 -top-1.5 h-4 w-4 rounded-full bg-surface text-brand" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-sm font-semibold">
                          <span className="tnum text-xs font-bold text-faint">{i + 1}</span>{st.t}
                        </span>
                        <span className="mt-0.5 block text-xs leading-snug text-muted">{st.d}</span>
                      </span>
                      <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-faint transition group-hover:translate-x-0.5 group-hover:text-brand" />
                    </Link>
                  </Tilt>
                </li>
              ))}
            </ol>
          </Section>
        </motion.div>

        <motion.aside variants={rise} className="space-y-4" aria-label="Detail proses">
          <Panel title="Waktu per tahap" hint="Durasi aktual dari run terakhir">
            {stages.length ? (
              <ul className="space-y-3">
                {stages.map(([k, v], i) => (
                  <li key={k}>
                    <div className="mb-1 flex items-baseline justify-between text-xs">
                      <span className="font-medium capitalize">{k}</span>
                      <span className="tnum text-muted">{secs(v)}{totalStage > 0 && <span className="ml-1.5 text-faint">{Math.round((v / totalStage) * 100)}%</span>}</span>
                    </div>
                    <Meter value={v} max={stages[0][1]} color={i === 0 ? 'rgb(var(--brand))' : 'rgb(var(--brand) / .5)'} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm leading-relaxed text-muted">Jalankan audit untuk melihat waktu proses tiap tahap.</p>
            )}
          </Panel>
          <Alert kind="info" title="Manusia tetap memutuskan">
            Tidak ada penolakan klaim otomatis. Rumah sakit tetap berhak menyanggah, dan setiap keputusan tercatat di audit trail.
          </Alert>
          {s?.shap_status && <p className="px-1 text-xs leading-relaxed text-faint">{s.shap_status}</p>}
        </motion.aside>
      </div>
    </motion.div>
  )
}
