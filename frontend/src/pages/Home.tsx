import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  Activity,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Coins,
  Database,
  FileText,
  Flag,
  Grid3x3,
  Hourglass,
  Play,
  Search,
  Sparkles,
  Timer,
  UploadCloud,
} from 'lucide-react'
import Stage from '../components/Stage'
import { Alert, GLASS, Meter, Panel, Section, Stat, StatGrid, Tilt, stagger, rise } from '../components/ui'
import { canRun, useApp } from '../lib/app'
import { num, rp, secs } from '../lib/format'

const pct1 = (v: number) => v.toFixed(1).replace('.', ',')

export default function HomePage() {
  const { run, user, reduced } = useApp()
  const [fps, setFps] = useState<number | null>(null)
  const [burst, setBurst] = useState(0)
  const lastRun = useRef<string | null>(null)
  const s = run?.summary
  const counts = run?.meta?.actual
    ? {
        p: run.meta.actual.procurement,
        r: run.meta.actual.rme_medication_administration,
        c: run.meta.actual.claims,
      }
    : s
      ? { p: undefined, r: undefined, c: s.records }
      : undefined
  const stages = s
    ? Object.entries(s.stage_seconds as Record<string, number>)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
    : []
  const totalStage = stages.reduce((a, [, v]) => a + v, 0)

  // Gelombang kejut di scene ketika data run baru tiba
  useEffect(() => {
    if (run?.id && lastRun.current && lastRun.current !== run.id) setBurst((b) => b + 1)
    lastRun.current = run?.id ?? null
  }, [run?.id])

  const doors = [
    { c: '#4C9AFF', code: 'P1', t: 'Procurement', d: 'Faktur e-Katalog / ERP', n: counts?.p },
    { c: '#2DD4A7', code: 'P2', t: 'Rekam Medis (RME)', d: 'Pemberian obat (FHIR)', n: counts?.r },
    { c: '#FFB020', code: 'P3', t: 'Klaim VEDIKA', d: 'Tagihan obat & alkes', n: counts?.c },
  ]

  const steps = [
    {
      to: '/audit',
      icon: UploadCloud,
      t: 'Muat Data & Jalankan Audit',
      d: 'Tiga pintu data masuk ke engine rekonsiliasi otomatis.',
      done: !!run,
    },
    {
      to: '/heatmap',
      icon: Grid3x3,
      t: 'Peta Anomali Faskes',
      d: 'Identifikasi selisih pengadaan vs klaim per fasilitas & kelas terapi.',
      done: false,
    },
    {
      to: '/inspector',
      icon: Search,
      t: 'Inspeksi Klaim Ter-flag',
      d: 'Tinjau bukti triangulasi, penjelasan AI, lalu ambil keputusan.',
      done: false,
    },
    ...(canRun(user)
      ? [
          {
            to: '/evaluasi',
            icon: BarChart3,
            t: 'Evaluasi Kinerja Model',
            d: 'Uji metrik precision, recall, dan transparansi batas model.',
            done: false,
          },
        ]
      : []),
  ]

  return (
    <motion.div
      variants={stagger}
      initial={reduced ? false : 'hidden'}
      animate="show"
      className="space-y-5 lg:space-y-6"
    >
      {/* ───────── Top Status Bar (Web App Command Strip) ───────── */}
      <motion.div
        variants={rise}
        className={`flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-2.5 text-xs ${GLASS}`}
      >
        <div className="flex items-center gap-2.5">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand/15 px-2.5 py-0.5 font-semibold text-brand ring-1 ring-inset ring-brand/30">
            <Sparkles className="h-3 w-3" /> Detect Smarter, Protect JKN
          </span>
          <span className="hidden text-muted sm:inline">•</span>
          <span className="hidden text-muted sm:inline">Triangulasi Pengadaan, RME, dan Klaim VEDIKA</span>
        </div>

        <div className="flex items-center gap-2 text-xs">
          {s ? (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-sunken/80 px-2.5 py-1 font-medium text-ink ring-1 ring-inset ring-white/10">
              <span className="h-2 w-2 rounded-full bg-brand" />
              Run ID: <strong className="font-mono text-brand">{run.id}</strong>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-sunken/70 px-2.5 py-1 text-muted ring-1 ring-inset ring-white/10">
              <span className="h-2 w-2 rounded-full bg-warn" />
              Menunggu eksekusi audit
            </span>
          )}
        </div>
      </motion.div>

      {/* ───────── Bento Hero: Control Deck + Interactive Stage ───────── */}
      <motion.section
        variants={rise}
        aria-label="Ringkasan produk dan visualisasi"
        className="grid gap-4 lg:grid-cols-12 lg:gap-5"
      >
        {/* Kiri: Panel Kontrol & 3 Pintu Data */}
        <div className={`flex flex-col justify-between rounded-2xl p-5 sm:p-6 lg:col-span-5 ${GLASS}`}>
          <div>
            <div className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand">
              <Database className="h-3.5 w-3.5" /> Engine Rekonsiliasi Triangulasi
            </div>

            <h1
              className="mt-2.5 font-display text-2xl font-bold leading-[1.12] tracking-tight text-ink sm:text-3xl xl:text-[2.15rem]"
              style={{ fontVariationSettings: "'wdth' 90" }}
            >
              Audit triangulasi sebelum klaim dibayar
            </h1>

            <p className="mt-2.5 text-xs leading-relaxed text-muted sm:text-sm">
              Cocokkan faktur pengadaan, rekam medis elektronik, dan tagihan klaim dalam satu siklus terpadu. AI
              memberi skor prioritas dan bukti; keputusan akhir tetap di tangan verifikator.
            </p>

            {/* Tombol Aksi Utama (Fleksibel di Mobile & Desktop) */}
            <div className="mt-5 grid grid-cols-1 gap-2.5 sm:flex sm:flex-wrap">
              {canRun(user) && (
                <Link to="/audit?auto=demo" className="btn-primary justify-center sm:justify-start">
                  <Play className="h-4 w-4 shrink-0" /> Muat Skenario Demo
                </Link>
              )}
              <Link to="/audit" className="btn-ghost justify-center sm:justify-start">
                <UploadCloud className="h-4 w-4 shrink-0" /> Upload &amp; Audit Data
              </Link>
            </div>
          </div>

          {/* 3 Pintu Data: Selalu tampil rapi di semua ukuran layar */}
          <div className="mt-6 border-t border-line/60 pt-4">
            <div className="mb-2.5 flex items-center justify-between text-2xs font-semibold uppercase tracking-wider text-muted">
              <span>Arsitektur 3 Pintu Input</span>
              <span>Jumlah Record</span>
            </div>
            <ul className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1">
              {doors.map((d) => (
                <li
                  key={d.code}
                  className="flex items-center justify-between gap-2.5 rounded-xl bg-sunken/55 px-3 py-2 ring-1 ring-inset ring-white/10 transition-colors hover:bg-sunken/80"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: d.c, boxShadow: `0 0 8px ${d.c}` }}
                    />
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-ink">
                        <span className="mr-1 font-mono text-[10px] text-muted">{d.code}</span>
                        {d.t}
                      </div>
                      <div className="truncate text-[11px] text-muted lg:block">{d.d}</div>
                    </div>
                  </div>
                  <span className="shrink-0 rounded-md bg-surface/80 px-2 py-0.5 font-mono text-xs font-semibold text-ink ring-1 ring-white/10">
                    {d.n !== undefined ? num(d.n) : '—'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Kanan: Kanvas Visualisasi Interaktif */}
        <div className={` relative flex flex-col overflow-hidden rounded-2xl lg:col-span-7 ${GLASS}`}>
          {/* Header Bar Kanvas */}
          <div className="z-10 flex items-center justify-between gap-2 border-b border-white/10 bg-side/60 px-4 py-2.5 text-xs text-white/80 backdrop-blur-md">
            <div className="flex items-center gap-2 font-medium">
              <Activity className="h-3.5 w-3.5 text-brand" />
              <span>Simulasi Aliran Rekonsiliasi Klaim</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="hidden text-[11px] text-white/55 sm:inline">Klik node untuk detail</span>
              {!reduced && fps !== null && (
                <span className="rounded-md bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-white/75 ring-1 ring-white/15">
                  {fps} FPS
                </span>
              )}
            </div>
          </div>

          <Stage
            className="min-h-[19rem] flex-1 sm:min-h-[23rem] lg:min-h-[26rem]"
            counts={counts}
            flagged={s?.flagged}
            total={s?.records}
            anomRate={s ? s.flagged_pct / 100 : 0.15}
            running={false}
            progress={0}
            burst={burst}
            onFps={setFps}
          >
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-between gap-2 bg-gradient-to-t from-stage via-stage/85 to-transparent px-4 pb-3 pt-8 text-xs text-white/75">
              <span className="inline-flex items-center gap-2 rounded-full bg-black/40 px-3 py-1 backdrop-blur-md ring-1 ring-white/15">
                <span className="h-2 w-2 shrink-0 rounded-full bg-[#FF6B5E] shadow-[0_0_10px_#FF6B5E]" />
                {s
                  ? `Partikel merah: ${pct1(s.flagged_pct as number)}% klaim ter-flag`
                  : 'Mode pratinjau: ~15% partikel merah sebelum audit dijalankan'}
              </span>
            </div>
          </Stage>
        </div>
      </motion.section>

      {/* ───────── Angka Kunci (Bento KPI Row) ───────── */}
      <motion.section variants={rise} aria-label="Ringkasan hasil audit">
        <StatGrid cols="grid-cols-2 sm:grid-cols-3 xl:grid-cols-5">
          <Stat
            icon={<FileText />}
            label="Klaim Diproses"
            count={s?.records ?? null}
            value="—"
            sub={s ? `${s.facilities} fasilitas kesehatan` : 'Belum ada audit aktif'}
          />
          <Stat
            icon={<Flag />}
            tone="risk"
            label="Klaim Ter-flag"
            count={s?.flagged ?? null}
            value="—"
            sub={
              s
                ? `${pct1(s.flagged_pct as number)}% dari total · ${num(s.high_priority)} prioritas tinggi`
                : 'Menunggu hasil rekonsiliasi'
            }
          />
          <Stat
            icon={<Coins />}
            tone="warn"
            label="Potensi Selisih"
            value={s ? rp(s.potential_difference) : '—'}
            sub="Estimasi dari klaim ter-flag, bukan penolakan final"
          />
          <Stat
            icon={<Hourglass />}
            tone="info"
            label="Menunggu Faktur"
            count={s?.waiting_invoice ?? null}
            value="—"
            sub={s ? `Tertahan ${rp(s.held_value)} · masa tenggang` : 'Masa tenggang 14 hari'}
          />
          <Stat
            icon={<Timer />}
            tone="brand"
            label="Waktu Proses"
            value={secs(s?.process_seconds)}
            sub="Pseudonimisasi + analitik terukur"
            className="col-span-2 sm:col-span-1"
          />
        </StatGrid>
      </motion.section>

      {/* ───────── Langkah Alur Kerja + Telemetri Tahap ───────── */}
      <div className="grid gap-5 lg:grid-cols-12">
        <motion.div variants={rise} className="lg:col-span-7 xl:col-span-8">
          <Section
            title="Alur Kerja Verifikasi"
            hint="Urutan modul yang disarankan untuk menyelesaikan satu siklus audit klaim"
          >
            <ol className="grid gap-3 sm:grid-cols-2">
              {steps.map((st, i) => (
                <li key={st.to} className="h-full">
                  <Tilt className="h-full rounded-2xl" max={4}>
                    <Link
                      to={st.to}
                      className={`group flex h-full flex-col justify-between rounded-2xl p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-brand/40 hover:shadow-pop ${GLASS}`}
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="inline-flex items-center gap-1.5 rounded-lg bg-sunken/80 px-2 py-0.5 font-mono text-[11px] font-semibold text-muted ring-1 ring-inset ring-white/10">
                            TAHAP 0{i + 1}
                          </span>
                          {st.done ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-brand/15 px-2 py-0.5 text-[11px] font-semibold text-brand ring-1 ring-brand/30">
                              <CheckCircle2 className="h-3 w-3" /> Selesai
                            </span>
                          ) : (
                            <ArrowRight className="h-4 w-4 text-faint transition-transform duration-200 group-hover:translate-x-1 group-hover:text-brand" />
                          )}
                        </div>

                        <div className="mt-3 flex items-start gap-3">
                          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sunken text-brand ring-1 ring-inset ring-white/10 transition-colors duration-200 group-hover:bg-brand group-hover:text-onbrand">
                            <st.icon className="h-5 w-5" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="font-display text-sm font-semibold tracking-tight text-ink group-hover:text-brand sm:text-base">
                              {st.t}
                            </div>
                            <p className="mt-1 text-xs leading-relaxed text-muted">{st.d}</p>
                          </div>
                        </div>
                      </div>
                    </Link>
                  </Tilt>
                </li>
              ))}
            </ol>
          </Section>
        </motion.div>

        <motion.aside
          variants={rise}
          className="flex flex-col gap-4 lg:col-span-5 xl:col-span-4"
          aria-label="Detail proses dan kepatuhan"
        >
          <Panel
            title="Telemetri Waktu per Tahap"
            hint="Durasi eksekusi aktual dari siklus run terakhir"
            right={
              totalStage > 0 ? (
                <span className="rounded-lg bg-sunken px-2 py-0.5 font-mono text-xs font-semibold text-brand">
                  {secs(totalStage)}
                </span>
              ) : undefined
            }
          >
            {stages.length ? (
              <ul className="space-y-3">
                {stages.map(([k, v], i) => (
                  <li key={k}>
                    <div className="mb-1.5 flex items-baseline justify-between text-xs">
                      <span className="font-medium capitalize text-ink">{k.replace(/_/g, ' ')}</span>
                      <span className="font-mono text-muted">
                        {secs(v)}
                        {totalStage > 0 && (
                          <span className="ml-1.5 text-[11px] text-faint">
                            ({Math.round((v / totalStage) * 100)}%)
                          </span>
                        )}
                      </span>
                    </div>
                    <Meter
                      value={v}
                      max={stages[0][1]}
                      color={i === 0 ? 'rgb(var(--brand))' : 'rgb(var(--brand) / .55)'}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <div className="rounded-xl bg-sunken/40 p-4 text-center text-xs leading-relaxed text-muted ring-1 ring-inset ring-white/5">
                Belum ada telemetri aktif. Jalankan skenario audit untuk melihat rincian waktu komputasi per tahap.
              </div>
            )}
          </Panel>

          <Alert kind="info" title="Prinsip Human-in-the-Loop">
            Tidak ada penolakan klaim otomatis. Rumah sakit berhak menyanggah temuan, dan setiap keputusan verifikator
            tercatat di <em>audit trail</em>.
          </Alert>

          {s?.shap_status && (
            <p className="px-1 text-[11px] leading-relaxed text-faint">Status Explainability: {s.shap_status}</p>
          )}
        </motion.aside>
      </div>
    </motion.div>
  )
}