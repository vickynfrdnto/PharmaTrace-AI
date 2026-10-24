import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, CheckCircle2, Circle, Download, FileJson, FileSpreadsheet, Loader2, Play, Upload, X } from 'lucide-react'
import Stage from '../components/Stage'
import { Alert, Field, Meter, PageHeader, Panel, Section, Stat, StatGrid, Tabs } from '../components/ui'
import { canRun, useApp } from '../lib/app'
import { downloadFile } from '../lib/api'
import { num, rp, secs } from '../lib/format'
import { useJob } from '../lib/useJob'

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex w-full items-center gap-3 rounded-xl bg-sunken/60 p-3 text-left ring-1 ring-line transition hover:bg-sunken">
      <span className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-brand' : 'bg-faint/40'}`}>
        <motion.span className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow" animate={{ left: checked ? 18 : 2 }} transition={{ type: 'spring', stiffness: 500, damping: 32 }} />
      </span>
      <span className="min-w-0"><span className="block text-sm font-semibold">{label}</span>{hint && <span className="block text-xs text-muted">{hint}</span>}</span>
    </button>
  )
}

function FileSlot({ tag, label, ext, file, onFile }: { tag: string; label: string; ext: string; file: File | null; onFile: (f: File | null) => void }) {
  const [over, setOver] = useState(false)
  const Icon = ext === '.json' ? FileJson : FileSpreadsheet
  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setOver(true) }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files?.[0]; if (f) onFile(f) }}
      className={`group flex cursor-pointer items-center gap-3 rounded-xl p-3 ring-1 ring-inset transition ${file ? 'bg-brand/8 ring-brand/40' : over ? 'bg-brand/10 ring-brand ring-2' : 'bg-sunken/40 ring-line hover:bg-sunken hover:ring-brand/40'}`}
    >
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg transition ${file ? 'bg-brand text-onbrand' : 'bg-surface text-muted ring-1 ring-line group-hover:text-brand'}`}><Icon className="h-5 w-5" /></span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2"><span className="text-sm font-semibold">{label}</span><span className="chip chip-mute !py-0">{tag}</span></span>
        <span className="block truncate text-xs text-muted">{file?.name ?? `Seret atau pilih berkas ${ext}`}</span>
      </span>
      {file
        ? <button type="button" className="rounded-md p-1 text-muted hover:bg-surface hover:text-risk" aria-label={`Hapus ${label}`} onClick={(e) => { e.preventDefault(); onFile(null) }}><X className="h-4 w-4" /></button>
        : <Upload className="h-4 w-4 shrink-0 text-faint" />}
      <input type="file" accept={ext} className="sr-only" onChange={(e) => onFile(e.target.files?.[0] ?? null)} />
    </label>
  )
}

export default function Audit() {
  const { user, config, refreshRun, run } = useApp()
  const [params, setParams] = useSearchParams()
  const [tab, setTab] = useState<'demo' | 'upload'>('demo')
  const [records, setRecords] = useState(10000)
  const [seed, setSeed] = useState<number>(config?.default_seed ?? 20261011)
  const [showcase, setShowcase] = useState(true)
  const [thr, setThr] = useState(20)
  const [di, setDi] = useState(20)
  const [files, setFiles] = useState<Record<string, File | null>>({ procurement: null, rme: null, claims: null, labels: null })
  const [burst, setBurst] = useState(0)
  const [downloadError, setDownloadError] = useState('')
  const { job, start } = useJob(() => { refreshRun(); setBurst((b) => b + 1) })
  const busy = job.status === 'queued' || job.status === 'running'
  const allowed = canRun(user)
  const auto = useRef(false)

  const runSynthetic = (rec = records, sd = seed, sc = showcase) =>
    start('/audit/run', { json: { records: rec, seed: sd, showcase: sc, threshold_pct: thr, di_threshold: di } })

  useEffect(() => {
    if (params.get('auto') === 'demo' && allowed && !auto.current) {
      auto.current = true
      setParams({}, { replace: true })
      runSynthetic(10000, config?.default_seed ?? 20261011, true)
    }
  }, [params, allowed])  // eslint-disable-line

  const runUpload = () => {
    const f = new FormData()
    f.append('procurement_file', files.procurement!); f.append('rme_file', files.rme!); f.append('claims_file', files.claims!)
    if (files.labels) f.append('labels_file', files.labels)
    f.append('threshold_pct', String(thr)); f.append('di_threshold', String(di))
    start('/audit/upload', { form: f })
  }
  const dl = async (n: string) => {
    setDownloadError('')
    try { await downloadFile(`/datasets/synthetic/${n}?records=${records}&seed=${seed}&showcase=${showcase}`, n) }
    catch (e) { setDownloadError((e as Error).message) }
  }
  const done = job.status === 'done' ? run : null
  const s = done?.summary
  const uploadReady = !!(files.procurement && files.rme && files.claims)
  const current = job.stages.find((x) => x.status === 'running')
  const setFile = (k: string) => (f: File | null) => setFiles((p) => ({ ...p, [k]: f }))

  return (
    <div>
      <PageHeader title="Upload & Audit" subtitle="Muat data dari tiga pintu, atur ambang, lalu jalankan audit. Waktu tiap tahap diukur langsung di backend." />

      <div className="mb-4">
        <Alert kind="warn" title="Gunakan data sintetis untuk demo">
          Jangan unggah data pasien, peserta JKN, tenaga kesehatan, atau fasilitas yang nyata. Pseudonimisasi pada prototipe ini bukan pengganti kontrol keamanan dan persetujuan pemrosesan data.
        </Alert>
      </div>

      {!allowed && (
        <div className="mb-4">
          <Alert kind="warn" title="Peran Verifikator tidak dapat menjalankan audit">
            Masuk sebagai Supervisor atau Admin untuk memuat data. Hasil audit terbaru tetap bisa ditinjau di Claim Inspector.
          </Alert>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[26rem_1fr]">
        {/* ───────── Konfigurasi ───────── */}
        <section aria-label="Konfigurasi audit" className="xl:sticky xl:top-[4.2rem] xl:self-start">
          <Panel>
            <Tabs value={tab} onChange={setTab} items={[{ id: 'demo', label: 'Data sintetis demo' }, { id: 'upload', label: 'Unggah 3 berkas' }]} className="mb-4" />
            <AnimatePresence mode="wait" initial={false}>
              {tab === 'demo' ? (
                <motion.div key="demo" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }} className="space-y-3.5">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Record per pintu" hint={`Maksimal ${num(config?.max_records ?? 30000)}`}>
                      <input className="input" type="number" min={200} max={config?.max_records ?? 30000} step={500} value={records} onChange={(e) => setRecords(+e.target.value)} />
                    </Field>
                    <Field label="Seed" hint="Hasil bisa direproduksi">
                      <input className="input" type="number" value={seed} onChange={(e) => setSeed(+e.target.value)} />
                    </Field>
                    <Field label="Ambang heatmap (%)" hint="Batas selisih per faskes">
                      <input className="input" type="number" value={thr} onChange={(e) => setThr(+e.target.value)} />
                    </Field>
                    <Field label="Ambang DI (ML-only)" hint="Skor 0 sampai 100">
                      <input className="input" type="number" value={di} onChange={(e) => setDi(+e.target.value)} />
                    </Field>
                  </div>
                  <Toggle checked={showcase} onChange={setShowcase} label="Sertakan kasus unggulan" hint="CLM-DEMO-01 sampai CLM-DEMO-06" />
                  <div className="flex gap-2">
                    <button className="btn-primary flex-1" disabled={!allowed || busy} onClick={() => runSynthetic()}>
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Jalankan audit
                    </button>
                    <button className="btn-ghost" disabled={!allowed || busy} onClick={() => runSynthetic(10000, config?.default_seed ?? 20261011, true)} title="10.000 record dengan kasus unggulan">
                      Skenario demo
                    </button>
                  </div>
                  <div className="well p-3">
                    <div className="text-sm font-semibold">Unduh berkas sintetis</div>
                    <p className="mt-0.5 text-xs text-muted">Pakai untuk mencoba alur unggah dengan data contoh.</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {['procurement.csv', 'rme.json', 'claims.csv', 'labels.csv'].map((n) => (
                        <button key={n} type="button" className="btn-ghost btn-sm" onClick={() => dl(n)}><Download className="h-3 w-3" /> {n}</button>
                      ))}
                    </div>
                    {downloadError && <p className="mt-2 text-xs text-risk" role="alert">Unduhan gagal: {downloadError}</p>}
                    <p className="mt-2.5 border-t border-line pt-2.5 text-xs leading-relaxed text-muted">
                      <b className="text-ink">labels.csv</b> adalah label fraud terpisah. Hanya dipakai untuk evaluasi dan tidak pernah menjadi fitur model.
                    </p>
                  </div>
                </motion.div>
              ) : (
                <motion.div key="upload" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }} className="space-y-2.5">
                  <FileSlot tag="Pintu 1" label="e-Katalog / ERP" ext=".csv" file={files.procurement} onFile={setFile('procurement')} />
                  <FileSlot tag="Pintu 2" label="RME FHIR-like" ext=".json" file={files.rme} onFile={setFile('rme')} />
                  <FileSlot tag="Pintu 3" label="Klaim VEDIKA" ext=".csv" file={files.claims} onFile={setFile('claims')} />
                  <FileSlot tag="Opsional" label="Label fraud" ext=".csv" file={files.labels} onFile={setFile('labels')} />
                  <button className="btn-primary w-full" disabled={!allowed || busy || !uploadReady} onClick={runUpload}>
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Jalankan audit
                  </button>
                  <p className="text-xs leading-relaxed text-muted">
                    {uploadReady ? 'Semua berkas wajib sudah dipilih.' : 'Pintu 1, 2, dan 3 wajib diunggah.'} Tanpa label, metrik supervised ditampilkan sebagai “belum tersedia”, bukan dipalsukan.
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </Panel>
        </section>

        {/* ───────── Progres & hasil ───────── */}
        <div className="min-w-0 space-y-5">
          <Stage className="h-[16rem] sm:h-[19rem]" running={busy} progress={job.progress} anomRate={s ? s.flagged_pct / 100 : 0.15} flagged={s?.flagged} total={s?.records} burst={burst} counts={run?.meta?.actual && s ? { p: run.meta.actual.procurement, r: run.meta.actual.rme_medication_administration, c: run.meta.actual.claims } : undefined}>
            <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2">
              <span className={`chip ring-white/15 ${busy ? 'bg-warn/20 text-[#FFD27A]' : job.status === 'done' ? 'bg-brand/25 text-[#7CF0C8]' : 'bg-white/10 text-white/70'}`}>
                {busy && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#FFB020]" />}
                {busy ? `Berjalan ${Math.round(job.progress * 100)}%` : job.status === 'done' ? 'Selesai' : 'Siaga'}
              </span>
              {busy && current && <span className="hidden text-xs text-white/70 sm:inline">{current.label}</span>}
            </div>
          </Stage>

          <Section title="Progres audit" hint="Setiap tahap dihitung di backend dan dilaporkan apa adanya" right={job.status !== 'idle' ? <span className="chip chip-mute tnum">{Math.round(job.progress * 100)}%</span> : undefined}>
            <Panel>
              {job.status === 'idle' ? (
                <p className="text-sm leading-relaxed text-muted">Belum ada audit berjalan. Tekan <b className="text-ink">Jalankan audit</b> untuk memulai.</p>
              ) : (
                <>
                  <Meter value={job.progress * 100} h="h-2" />
                  <ol className="mt-4 grid gap-x-8 gap-y-1 sm:grid-cols-2">
                    {job.stages.map((st) => (
                      <li key={st.key} className="flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-sm">
                        {st.status === 'done' ? <CheckCircle2 className="h-4 w-4 shrink-0 text-brand" /> : st.status === 'running' ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-warn" /> : <Circle className="h-4 w-4 shrink-0 text-faint/60" />}
                        <span className={st.status === 'pending' ? 'text-faint' : st.status === 'running' ? 'font-semibold' : ''}>{st.label}</span>
                        <span className="ml-auto text-xs tnum text-muted">{st.seconds !== null ? secs(st.seconds) : ''}</span>
                      </li>
                    ))}
                  </ol>
                </>
              )}
              {job.status === 'error' && (
                <div className="mt-4">
                  <Alert kind="error" title="Audit tidak dapat dijalankan">
                    {job.error}
                    {job.problems && job.problems.length > 0 && <ul className="mt-1 list-disc pl-5">{job.problems.map((p, i) => <li key={i}>{p}</li>)}</ul>}
                  </Alert>
                </div>
              )}
            </Panel>
          </Section>

          <AnimatePresence>
            {job.status === 'done' && s && (
              <motion.section initial={{ opacity: 0, y: 14, scale: 0.985 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 220, damping: 24 }} aria-label="Hasil audit">
                <Section title="Hasil audit" hint={`Selesai dalam ${secs(job.process_seconds)} · total termasuk simpan DB ${secs(job.total_seconds)}`}>
                  <div className="panel overflow-hidden ring-2 ring-brand/30">
                    <StatGrid cols="grid-cols-2 md:grid-cols-4" className="!rounded-none !shadow-none !ring-0">
                      <Stat label="Klaim diproses" count={s.records} />
                      <Stat label="Ter-flag" tone="risk" count={s.flagged} />
                      <Stat label="Potensi selisih" tone="warn" value={rp(s.potential_difference)} />
                      <Stat label="Menunggu faktur" tone="info" count={s.waiting_invoice} />
                    </StatGrid>
                    <div className="flex flex-wrap gap-2 p-3.5">
                      <Link to="/heatmap" className="btn-primary">Lihat heatmap <ArrowRight className="h-4 w-4" /></Link>
                      <Link to="/inspector" className="btn-teal">Claim Inspector</Link>
                      <Link to="/evaluasi" className="btn-ghost">Evaluasi model</Link>
                    </div>
                  </div>
                </Section>
              </motion.section>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
