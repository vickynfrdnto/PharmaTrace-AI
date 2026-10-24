import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, Dices, Flag } from 'lucide-react'
import { Alert, Empty, Loading, PageHeader, Stat, StatGrid } from '../components/ui'
import { api } from '../lib/api'
import { useApp } from '../lib/app'
import { pct, rp } from '../lib/format'

export default function RandomAudit() {
  const { run, user } = useApp()
  const [d, setD] = useState<any>(null)
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [pctIn, setPctIn] = useState(5)
  const [err, setErr] = useState('')
  const [filter, setFilter] = useState<'all' | 'todo'>('all')
  const load = () => api('/runs/latest/random-audit').then(setD).catch((e) => setErr(e.message))
  useEffect(() => { if (run) load() }, [run?.id])
  if (!run) return <Empty title="Belum ada hasil audit" hint="Sampel acak diambil dari klaim yang lolos otomatis pada run terakhir." action={<Link to="/audit" className="btn-primary">Ke Upload & Audit</Link>} />
  const review = async (claim_id: string, verdict: string) => {
    setErr('')
    try { setD(await api('/runs/latest/random-audit/review', { json: { claim_id, verdict, note: notes[claim_id] ?? '' } })) } catch (e) { setErr((e as Error).message) }
  }
  const redraw = async () => { try { setD(await api('/runs/latest/random-audit/redraw', { json: { pct: pctIn } })) } catch (e) { setErr((e as Error).message) } }
  const s = d?.stats
  const items = (d?.items ?? []).slice(0, 60).filter((it: any) => filter === 'all' || !it.review)
  return (
    <div>
      <PageHeader title="Audit Acak 5%" subtitle="Guardrail agar verifikator tidak bergantung buta pada model: sampel acak dari klaim yang lolos otomatis.">
        {user?.role === 'Supervisor' && (
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs font-medium text-muted">Sampel (%)<input type="number" min={1} max={50} className="input !w-16" value={pctIn} onChange={(e) => setPctIn(+e.target.value)} /></label>
            <button className="btn-ghost" onClick={redraw}><Dices className="h-4 w-4" /> Ambil sampel ulang</button>
          </div>
        )}
      </PageHeader>
      {err && <div className="mb-3"><Alert kind="error">{err}</Alert></div>}
      {!d && !err && <Loading />}
      {s && (
        <div className="space-y-4">
          <StatGrid cols="grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
            <Stat label="Klaim lolos otomatis" count={s.pool_auto_pass} sub="status Selaras" />
            <Stat label="Sampel acak" tone="brand" count={s.sample_size} sub={`${d.pct}% · seed ${d.seed} · tarikan #${d.draw_no}`} />
            <Stat label="Sudah ditinjau" tone="info" value={`${s.reviewed}/${s.sample_size}`} />
            <Stat label="Temuan masalah" tone="risk" count={s.issues_found} sub={s.issue_rate !== null ? `laju ${pct(s.issue_rate)}` : 'belum ada tinjauan'} />
            <Stat label="Taksiran fraud lolos" tone="warn" value={s.expected_missed_in_pool ? `${s.expected_missed_in_pool[0]}–${s.expected_missed_in_pool[1]}` : '—'} sub={s.ci95 ? `CI95 Wilson ${pct(s.ci95[0])}–${pct(s.ci95[1])}` : 'perlu minimal 1 tinjauan'} className="col-span-2 md:col-span-1" />
          </StatGrid>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-3xl text-xs leading-relaxed text-muted">Sampel acak (dapat direproduksi) dari klaim yang tidak ditandai AI, sehingga kebocoran yang luput bisa ditaksir. Tarik ulang sampel dicatat di audit trail.</p>
            <div className="flex items-center gap-2">
              <div className="flex rounded-lg bg-sunken p-0.5 text-xs font-semibold">
                {([['all', 'Semua'], ['todo', 'Belum ditinjau']] as const).map(([k, l]) => <button key={k} onClick={() => setFilter(k)} className={`rounded-md px-2.5 py-1 transition ${filter === k ? 'bg-surface shadow-lift' : 'text-muted'}`}>{l}</button>)}
              </div>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            <AnimatePresence initial={false}>
              {items.map((it: any) => (
                <motion.div layout key={it.claim_id} initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className={`panel p-3.5 ${it.review ? (it.review.verdict === 'Sesuai' ? 'ring-brand/50' : 'ring-risk/60') : ''}`}>
                  <div className="flex justify-between text-sm"><b>{it.claim_id}</b><span className="text-muted">{it.service_date}</span></div>
                  <div className="text-xs text-muted">{it.facility_name} · {it.generic} · {rp(it.amount)}</div>
                  <div className="my-2.5 grid grid-cols-3 gap-1.5 text-center text-xs">
                    <div className="rounded-lg bg-info/10 p-1.5"><div className="text-info">e-Katalog</div><b className="tnum">{it.available_stock}</b></div>
                    <div className="rounded-lg bg-brand/10 p-1.5"><div className="text-brand">RME</div><b className="tnum">{it.rme_expected}</b></div>
                    <div className="rounded-lg bg-warn/10 p-1.5"><div className="text-warn">Klaim</div><b className="tnum">{it.qty} {it.unit}</b></div>
                  </div>
                  {it.review ? (
                    <div className="flex items-center gap-1.5 text-xs">{it.review.verdict === 'Sesuai' ? <CheckCircle2 className="h-4 w-4 text-brand" /> : <Flag className="h-4 w-4 text-risk" />}<b>{it.review.verdict}</b><span className="text-muted">oleh {it.review.reviewer}</span></div>
                  ) : (
                    <div className="space-y-1.5">
                      <input className="input !py-1.5 text-xs" placeholder="Catatan (wajib bila ada masalah)" value={notes[it.claim_id] ?? ''} onChange={(e) => setNotes({ ...notes, [it.claim_id]: e.target.value })} aria-label={`Catatan ${it.claim_id}`} />
                      <div className="flex gap-1.5"><button className="btn-teal btn-sm flex-1" onClick={() => review(it.claim_id, 'Sesuai')}>Sesuai</button><button className="btn-danger btn-sm flex-1" onClick={() => review(it.claim_id, 'Ditemukan masalah')}>Ada masalah</button></div>
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
          {items.length === 0 && <Empty title="Semua sampel sudah ditinjau" hint="Ambil sampel ulang untuk menarik klaim baru." />}
        </div>
      )}
    </div>
  )
}
