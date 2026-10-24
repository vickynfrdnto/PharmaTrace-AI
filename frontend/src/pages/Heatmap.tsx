import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ArrowUpRight, Flame, Loader2, MousePointerClick } from 'lucide-react'
import { api } from '../lib/api'
import { useApp } from '../lib/app'
import { useMedia } from '../lib/hooks'
import { Alert, Empty, PageHeader, Panel, Sheet } from '../components/ui'
import { num, rp } from '../lib/format'

function Metric({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="well p-2.5">
      <div className="text-xs text-muted">{label}</div>
      <div className={`mt-0.5 font-num text-base font-bold ${tone ?? ''}`}>{value}</div>
    </div>
  )
}

function Drill({ sel, claims, thr }: { sel: any; claims: any[]; thr: number }) {
  return (
    <>
      <div className="font-display text-lg font-semibold leading-snug">{sel.facility_name}</div>
      <div className="mt-0.5 text-xs text-muted">Kategori {sel.category}</div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Metric label="Nilai klaim" value={rp(sel.claim_value)} />
        <Metric label="Nilai pengadaan" value={rp(sel.proc_value)} />
        <Metric label="Selisih" value={sel.diff_pct >= 999 ? 'Tanpa pengadaan' : `${sel.diff_pct.toFixed(1)}%`} tone={sel.diff_pct >= thr ? 'text-risk' : undefined} />
        <Metric label="Ter-flag / baris" value={`${num(sel.flagged)} / ${num(sel.claim_lines)}`} />
      </div>
      <div className="mt-4 border-t border-line pt-3.5">
        <div className="text-sm font-semibold">Klaim ter-flag teratas</div>
        <div className="text-xs text-muted">Diurutkan menurut Discrepancy Index</div>
        <ul className="mt-2.5 space-y-2">
          {claims.length === 0 && <li className="text-sm text-muted">Tidak ada klaim ter-flag di sel ini, atau di luar penugasan Anda.</li>}
          {claims.map((c) => (
            <li key={c.key}>
              <Link to={`/inspector?key=${encodeURIComponent(c.key)}`} className="group block rounded-xl bg-surface p-2.5 text-xs ring-1 ring-line transition hover:ring-brand/50 hover:shadow-lift">
                <div className="flex items-center justify-between gap-2">
                  <b className="text-sm">{c.claim_id}</b>
                  <span className="flex items-center gap-1 font-semibold text-risk">DI {c.di.toFixed(0)}<ArrowUpRight className="h-3 w-3 opacity-50 transition group-hover:opacity-100" /></span>
                </div>
                <div className="mt-0.5 text-muted">{c.generic} · {c.qty} {c.unit} · {rp(c.potential_difference)}</div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}

export default function Heatmap() {
  const { run, config, reduced } = useApp()
  const wide = useMedia('(min-width: 1280px)')
  const [data, setData] = useState<any>(null)
  const [thr, setThr] = useState<number>(config?.heatmap_threshold_pct ?? 20)
  const [sort, setSort] = useState<'risk' | 'name'>('risk')
  const [sel, setSel] = useState<any>(null)
  const [claims, setClaims] = useState<any[]>([])
  const [err, setErr] = useState('')

  useEffect(() => { if (run) api('/runs/latest/heatmap').then(setData).catch((e) => setErr(e.message)) }, [run?.id])
  useEffect(() => {
    if (!sel) return
    setClaims([])
    api(`/runs/latest/claims?facility=${sel.facility_id}&category=${encodeURIComponent(sel.category)}&flagged_only=true&limit=8`).then((r) => setClaims(r.items)).catch(() => setClaims([]))
  }, [sel])

  const cellMap = useMemo(() => {
    const m = new Map<string, any>()
    data?.cells.forEach((c: any) => m.set(`${c.facility_id}|${c.category}`, c))
    return m
  }, [data])
  const facilities = useMemo(() => {
    const m = new Map<string, any>()
    data?.cells.forEach((c: any) => {
      const f = m.get(c.facility_id) ?? { id: c.facility_id, name: c.facility_name, klass: c.peer_class, max: 0 }
      f.max = Math.max(f.max, c.diff_pct)
      m.set(c.facility_id, f)
    })
    const arr = [...m.values()]
    return sort === 'risk' ? arr.sort((a, b) => b.max - a.max) : arr.sort((a, b) => a.name.localeCompare(b.name))
  }, [data, sort])
  const hot = useMemo(() => [...(data?.cells ?? [])].sort((a: any, b: any) => b.flagged - a.flagged || b.diff_pct - a.diff_pct).slice(0, 3), [data])
  const cell = (f: string, c: string) => cellMap.get(`${f}|${c}`)
  const tone = (v: number) => (v >= thr ? 'bg-risk text-white shadow-[0_6px_14px_-8px_rgb(var(--risk))]' : v >= thr / 2 ? 'bg-[#F4B24E] text-[#4A2D00]' : 'bg-brand/12 text-brand')
  const reds = data?.cells.filter((c: any) => c.diff_pct >= thr).length ?? 0
  const total = data?.cells.length ?? 0
  const cats: string[] = data?.categories ?? []

  if (!run) return <Empty title="Belum ada hasil audit" hint="Jalankan audit di Upload & Audit untuk membangun heatmap selisih RS × kategori obat." action={<Link to="/audit" className="btn-primary">Ke Upload & Audit</Link>} />

  return (
    <div>
      <PageHeader title="Heatmap Selisih" subtitle="Nilai pengadaan dibanding klaim untuk tiap rumah sakit dan kategori obat. Sel merah melewati ambang.">
        <label className="flex items-center gap-3 rounded-xl bg-surface px-3 py-2 text-sm shadow-lift ring-1 ring-line">
          <span className="text-xs font-semibold">Ambang merah</span>
          <input type="range" min={5} max={60} value={thr} onChange={(e) => setThr(+e.target.value)} className="h-1.5 w-28 cursor-pointer accent-[rgb(var(--brand))] sm:w-36" aria-label="Ambang selisih merah (persen)" />
          <b className="w-11 text-right font-num text-brand">&gt;{thr}%</b>
        </label>
      </PageHeader>

      {err && <div className="mb-4"><Alert kind="error" title="Heatmap tidak dapat dimuat">{err}</Alert></div>}
      {!data && !err && <div className="panel flex items-center justify-center gap-2 p-10 text-sm text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Memuat heatmap…</div>}

      {data && (
        <div className="grid gap-5 xl:grid-cols-[1fr_22rem]">
          <section aria-label="Matriks selisih" className="min-w-0 space-y-4">
            {hot.length > 0 && (
              <div className="grid gap-2.5 sm:grid-cols-3">
                {hot.map((h: any, i: number) => (
                  <button key={`${h.facility_id}${h.category}`} onClick={() => setSel(h)} className="panel group flex items-center gap-3 p-3 text-left transition hover:shadow-pop">
                    <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${i === 0 ? 'bg-risk text-white' : 'bg-risk/10 text-risk'}`}><Flame className="h-4 w-4" /></span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{h.facility_name}</span>
                      <span className="block truncate text-xs text-muted">{h.category} · {num(h.flagged)} ter-flag · {h.diff_pct >= 999 ? 'tanpa pengadaan' : `${h.diff_pct.toFixed(0)}%`}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}

            <div className="panel overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 border-b border-line px-4 py-2.5">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                  <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded bg-brand/25" />di bawah {thr / 2}%</span>
                  <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded bg-[#F4B24E]" />{thr / 2} sampai {thr}%</span>
                  <span className="flex items-center gap-1.5"><i className="h-3 w-3 rounded bg-risk" />di atas {thr}%</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="chip chip-risk tnum">{reds} dari {num(total)} sel di atas ambang</span>
                  <select className="input !w-auto !py-1 text-xs" value={sort} onChange={(e) => setSort(e.target.value as any)} aria-label="Urutkan faskes">
                    <option value="risk">Urut: selisih tertinggi</option><option value="name">Urut: nama</option>
                  </select>
                </div>
              </div>
              <div className="scroll-slim overflow-x-auto p-2.5 sm:p-3">
                <table className="w-full border-separate border-spacing-1 text-sm">
                  <thead>
                    <tr>
                      <th className="sticky left-0 z-10 min-w-[8.5rem] bg-surface pr-2 text-left text-xs font-semibold text-muted">Faskes</th>
                      {cats.map((c) => <th key={c} className="min-w-[3.6rem] px-1 text-center text-xs font-semibold text-muted">{c}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {facilities.map((f, ri) => (
                      <tr key={f.id}>
                        <td className="sticky left-0 z-10 whitespace-nowrap bg-surface pr-2">
                          <div className="text-sm font-semibold">{f.name}</div>
                          <div className="text-xs text-faint">{f.klass}</div>
                        </td>
                        {cats.map((c, ci) => {
                          const x = cell(f.id, c)
                          if (!x) return <td key={c} className="rounded-lg bg-sunken/50 text-center text-xs text-faint">—</td>
                          const active = sel?.facility_id === f.id && sel?.category === c
                          return (
                            <td key={c} className="p-0">
                              <motion.button
                                type="button"
                                initial={reduced ? false : { opacity: 0, scale: 0.7 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ delay: reduced ? 0 : Math.min(0.5, (ri + ci) * 0.025), type: 'spring', stiffness: 340, damping: 22 }}
                                whileHover={reduced ? undefined : { scale: 1.12, zIndex: 5 }}
                                onClick={() => setSel(x)}
                                aria-pressed={active}
                                aria-label={`${f.name}, ${c}: ${x.diff_pct >= 999 ? 'tanpa pengadaan' : `${x.diff_pct.toFixed(0)} persen`}`}
                                className={`relative w-full rounded-lg px-1 py-2.5 text-center font-num text-sm font-bold ${tone(x.diff_pct)} ${active ? 'ring-2 ring-ink ring-offset-2 ring-offset-surface' : ''}`}
                              >
                                {x.diff_pct >= 999 ? '∞' : `${x.diff_pct.toFixed(0)}%`}
                              </motion.button>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          {wide ? (
            <aside aria-label="Rincian sel" className="xl:sticky xl:top-[4.2rem] xl:self-start">
              <Panel title="Rincian sel" hint={sel ? undefined : 'Klik sel pada matriks'}>
                {!sel ? (
                  <div className="grid min-h-[16rem] place-items-center text-center">
                    <div>
                      <span className="mx-auto mb-3 grid h-11 w-11 animate-floaty place-items-center rounded-2xl bg-sunken text-brand"><MousePointerClick className="h-5 w-5" /></span>
                      <p className="max-w-[15rem] text-sm leading-relaxed text-muted">Pilih sel untuk melihat nilai klaim, pengadaan, dan klaim ter-flag di dalamnya.</p>
                    </div>
                  </div>
                ) : <Drill sel={sel} claims={claims} thr={thr} />}
              </Panel>
            </aside>
          ) : (
            <Sheet open={!!sel} onClose={() => setSel(null)} title="Rincian sel">{sel && <Drill sel={sel} claims={claims} thr={thr} />}</Sheet>
          )}
        </div>
      )}
    </div>
  )
}
