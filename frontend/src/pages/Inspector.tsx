import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, Search, Sparkles } from 'lucide-react'
import { Alert, DiGauge, Empty, PageHeader, Panel, Tilt } from '../components/ui'
import { api } from '../lib/api'
import { useApp } from '../lib/app'
import { useMedia } from '../lib/hooks'
import { C, diTone, rp, statusColor, tooltipStyle, utcToWib } from '../lib/format'

const BTN: Record<string, string> = {
  'Tolak Klaim': 'btn-danger', 'Minta Klarifikasi RS': 'btn-amber', 'Pengecualian Medis': 'btn-teal', 'RS Menyanggah': 'btn-ghost',
  'Sanggahan Diterima': 'btn-teal', 'Sanggahan Ditolak': 'btn-danger',
}
const DEMO = ['01', '02', '03', '04', '05', '06']
const BAR = { risk: 'bg-risk', warn: 'bg-warn', brand: 'bg-brand' } as const
const TEXT = { risk: 'text-risk', warn: 'text-warn', brand: 'text-brand' } as const

function DoorCard({ tag, title, value, unit, note, color }: { tag: string; title: string; value: React.ReactNode; unit: string; note: string; color: string }) {
  return (
    <Tilt className="rounded-2xl" max={6}>
      <div className="relative h-full overflow-hidden rounded-2xl bg-surface p-3.5 ring-1 ring-line">
        <span className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-25 blur-2xl" style={{ background: color }} aria-hidden />
        <div className="relative flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-xs font-semibold"><i className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />{title}</span>
          <span className="chip chip-mute !py-0">{tag}</span>
        </div>
        <div className="relative mt-2 font-num text-3xl font-bold">{value} <span className="font-sans text-sm font-medium text-muted">{unit}</span></div>
        <div className="relative mt-1 text-xs leading-snug text-muted">{note}</div>
      </div>
    </Tilt>
  )
}

export default function Inspector() {
  const { run, user } = useApp()
  const wide = useMedia('(min-width: 1280px)')
  const [sp, setSp] = useSearchParams()
  const [status, setStatus] = useState(sp.get('status') ?? 'Perlu review verifikator')
  const [q, setQ] = useState('')
  const [list, setList] = useState<{ total: number; items: any[] }>({ total: 0, items: [] })
  const [d, setD] = useState<any>(null)
  const [note, setNote] = useState('')
  const [msg, setMsg] = useState<{ kind: 'error' | 'info'; text: string } | null>(null)
  const selKey = sp.get('key')

  const loadList = () => api(`/runs/latest/claims?${new URLSearchParams({ ...(status ? { status } : {}), ...(q ? { q } : {}), limit: '60' })}`).then(setList).catch((e) => setMsg({ kind: 'error', text: e.message }))
  useEffect(() => { if (run) loadList() }, [run?.id, status, q])
  useEffect(() => {
    if (!wide || selKey || !list.items.length) return
    // Do not auto-select the previous queue while a new search (e.g. CLM-DEMO-01) is loading.
    const queryReady = !q || list.items.some((item) => item.claim_id.includes(q) || item.generic.toLowerCase().includes(q.toLowerCase()))
    if (queryReady) setSp({ key: list.items[0].key }, { replace: true })
  }, [list.items, selKey, wide, q])
  const loadDetail = () => selKey && api(`/claims/${encodeURIComponent(selKey)}`).then((x) => { setD(x); setMsg(null) }).catch((e) => { setD(null); setMsg({ kind: 'error', text: e.message }) })
  useEffect(() => { setNote(''); if (selKey) loadDetail(); else setD(null) }, [selKey])

  const decide = async (action: string) => {
    if (!d) return
    try {
      await api(`/claims/${encodeURIComponent(d.key)}/decision`, { json: { decision: action, note } })
      setMsg({ kind: 'info', text: `Keputusan "${action}" tersimpan dan tercatat di audit trail.` })
      setNote(''); await loadDetail(); loadList()
    } catch (e) { setMsg({ kind: 'error', text: (e as Error).message }) }
  }

  if (!run) return <Empty title="Belum ada hasil audit" hint="Jalankan audit terlebih dahulu." action={<Link to="/audit" className="btn-primary">Ke Upload & Audit</Link>} />
  const shapData = (d?.shap ?? []).map((s: any) => ({ ...s, v: +s.contribution.toFixed(4) }))
  const bd = d?.di_breakdown
  const showList = wide || !selKey
  const showDetail = wide || !!selKey

  return (
    <div>
      <PageHeader title="Claim Inspector" subtitle="Baca alasan AI, cocokkan tiga pintu, lalu putuskan. Setiap keputusan tercatat.">
        <div className="no-scrollbar flex max-w-full items-center gap-1.5 overflow-x-auto">
          <span className="mr-1 shrink-0 text-xs font-medium text-muted">Kasus unggulan</span>
          {DEMO.map((n) => <button key={n} className="btn-ghost btn-sm tnum shrink-0" onClick={() => { setStatus(''); setQ(`CLM-DEMO-${n}`); setSp({}, { replace: true }) }}>{n}</button>)}
          <button className="btn-ghost btn-sm shrink-0" onClick={() => { setStatus('Perlu review verifikator'); setQ(''); setSp({}, { replace: true }) }}>Atur ulang</button>
        </div>
      </PageHeader>

      <div className="grid gap-5 xl:grid-cols-[22rem_1fr]">
        {/* ───────── Antrean klaim ───────── */}
        {showList && (
          <aside className="panel flex h-[calc(100dvh-14rem)] min-h-[30rem] flex-col overflow-hidden xl:sticky xl:top-[4.2rem] xl:h-[calc(100dvh-6.2rem)]" aria-label="Antrean klaim">
            <div className="space-y-2 border-b border-line p-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-faint" />
                <input className="input !pl-9" placeholder="Cari ID klaim atau obat" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari klaim" />
              </div>
              <select className="input" value={status} onChange={(e) => { setStatus(e.target.value); setSp({}, { replace: true }) }} aria-label="Filter status">
                <option value="Perlu review verifikator">Perlu review</option><option value="Menunggu verifikasi faktur">Menunggu faktur</option><option value="Selaras">Selaras</option><option value="">Semua status</option>
              </select>
              <div className="text-xs text-muted">{list.total.toLocaleString('id-ID')} klaim{user?.facilities ? ' · faskes penugasan Anda' : ''}</div>
            </div>
            <ul className="scroll-slim flex-1 space-y-1 overflow-y-auto p-2">
              {list.items.map((c, i) => {
                const t = diTone(c.di) as keyof typeof BAR
                const active = selKey === c.key
                return (
                  <motion.li key={c.key} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(i, 10) * 0.02 }}>
                    <button onClick={() => setSp({ key: c.key })} aria-current={active} className={`relative w-full overflow-hidden rounded-xl p-2.5 pl-3.5 text-left transition ${active ? 'bg-brand/10 ring-1 ring-brand/40' : 'ring-1 ring-transparent hover:bg-sunken'}`}>
                      <span className={`absolute inset-y-2.5 left-1.5 w-1 rounded-full ${BAR[t]}`} aria-hidden />
                      <div className="flex items-center justify-between gap-2">
                        <b className="truncate text-sm">{c.claim_id}</b>
                        <span className={`font-num text-sm font-bold ${TEXT[t]}`}>DI {c.di.toFixed(0)}</span>
                      </div>
                      <div className="mt-0.5 truncate text-xs text-muted">{c.facility_name} · {c.generic}</div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span className={`chip ${statusColor(c.status)}`}>{c.status === 'Perlu review verifikator' ? 'Review' : c.status === 'Selaras' ? 'Selaras' : 'Tunggu faktur'}</span>
                        {c.decision_state !== 'Belum ditinjau' && <span className="chip chip-ok">{c.decision_state}</span>}
                      </div>
                    </button>
                  </motion.li>
                )
              })}
              {list.items.length === 0 && <li className="p-6 text-center text-sm text-muted">Tidak ada klaim untuk filter ini. Coba ubah status atau hapus kata kunci.</li>}
            </ul>
          </aside>
        )}

        {/* ───────── Detail klaim ───────── */}
        {showDetail && (!d ? (
          <div className="panel grid min-h-[18rem] place-items-center p-6 text-sm text-muted">
            {msg ? <Alert kind="error">{msg.text}</Alert> : 'Pilih klaim untuk melihat kartu penjelasan.'}
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div key={d.key} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }} className="min-w-0 space-y-4">
              {!wide && <button className="btn-ghost btn-sm" onClick={() => setSp({}, { replace: true })}><ArrowLeft className="h-4 w-4" /> Kembali ke antrean</button>}
              <section className="panel p-4 lg:p-5">
                <div className="flex flex-wrap items-start justify-between gap-5">
                  <div className="flex min-w-0 items-center gap-4">
                    <DiGauge value={d.di} />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-display text-xl font-bold tracking-tight">{d.claim_id}</h2>
                        <span className={`chip ${statusColor(d.status)}`}>{d.status}</span>
                        {d.priority && <span className="chip chip-mute">Prioritas {d.priority}</span>}
                      </div>
                      <div className="mt-1 text-sm">{d.facility_name} <span className="text-muted">({d.peer_class})</span> · {d.generic} · {d.service_date}</div>
                      <div className="mt-1 text-xs text-faint">Pasien <code className="text-muted">{d.pseudonym_patient.slice(0, 8)}…</code> · Dokter <code className="text-muted">{d.pseudonym_doctor.slice(0, 8)}…</code> · pseudonim HMAC · kanal {d.channel}</div>
                    </div>
                  </div>
                  <div className="sm:text-right">
                    <div className="text-xs font-medium text-muted">Potensi selisih</div>
                    <div className="mt-0.5 font-num text-3xl font-bold text-warn">{rp(d.potential_difference)}</div>
                    {d.held_value > 0 && <div className="mt-0.5 text-xs text-info">tertahan sementara {rp(d.held_value)}</div>}
                  </div>
                </div>

                <div className="mt-5 border-t border-line pt-4">
                  <div className="mb-2.5 text-sm font-semibold">Triangulasi tiga pintu</div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <DoorCard color="#4C9AFF" tag="Pintu 1" title="e-Katalog / ERP" value={d.three_doors.ekatalog.available_stock} unit={d.unit} note={`Stok tersedia saat klaim · total pengadaan periode ${d.three_doors.ekatalog.cell_total}`} />
                    <DoorCard color="#2DD4A7" tag="Pintu 2" title="RME" value={d.three_doors.rme.found ? d.three_doors.rme.expected : 0} unit={d.unit} note={d.three_doors.rme.found ? 'Setara dosis tercatat (dibulatkan ke atas)' : 'Pemberian tidak tercatat'} />
                    <DoorCard color="#FFB020" tag="Pintu 3" title="Klaim VEDIKA" value={d.three_doors.klaim.qty} unit={d.unit} note={d.rule_flags.length ? d.rule_flags.join(' · ') : 'Tanpa pelanggaran aturan'} />
                  </div>
                </div>
              </section>

              <div className="grid gap-4 lg:grid-cols-2">
                <Panel title="Kartu penjelasan" hint="Untuk verifikator">
                  <p className="text-sm leading-relaxed">{d.reason}</p>
                  <div className="mt-3 flex gap-2.5 rounded-xl bg-brand/8 p-3 text-xs leading-relaxed ring-1 ring-inset ring-brand/20">
                    <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />
                    <div><b className="text-brand">Rekomendasi AI:</b> {d.recommendation || 'Tidak ada tindakan diperlukan.'} <i className="text-muted">(bukan keputusan)</i></div>
                  </div>
                  {bd && (
                    <div className="mt-4">
                      <div className="mb-1.5 flex flex-wrap justify-between gap-x-3 text-xs text-muted">
                        <span className="font-semibold text-ink">Komposisi Discrepancy Index</span>
                        <span>aturan {(bd.weights.rule * 100).toFixed(0)}% · ML {(bd.weights.ml * 100).toFixed(0)}% · finansial {(bd.weights.financial * 100).toFixed(0)}%</span>
                      </div>
                      <div className="flex h-2.5 overflow-hidden rounded-full bg-sunken">
                        {[['rule', C.danger, 'Aturan'], ['ml', C.amber, 'ML'], ['financial', C.teal, 'Finansial']].map(([k, col, l], i) => (
                          <motion.div key={k} style={{ background: col }} initial={{ width: 0 }} animate={{ width: `${bd[k]}%` }} transition={{ delay: 0.15 + i * 0.1, type: 'spring', stiffness: 90, damping: 20 }} title={`${l} ${bd[k].toFixed(1)}`} />
                        ))}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                        <span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-risk" />Aturan {bd.rule.toFixed(1)}</span>
                        <span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-warn" />ML {bd.ml.toFixed(1)}</span>
                        <span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-brand" />Finansial {bd.financial.toFixed(1)}</span>
                      </div>
                    </div>
                  )}
                </Panel>

                <Panel title="Faktor penyumbang anomali" hint="SHAP · IsolationForest">
                  {shapData.length === 0 ? (
                    <p className="text-sm leading-relaxed text-muted">Penjelasan SHAP hanya dihitung untuk klaim ter-flag atau menunggu pada run ini.</p>
                  ) : (
                    <>
                      <div className="h-[11.5rem]"><ResponsiveContainer width="100%" height="100%"><BarChart data={shapData} layout="vertical" margin={{ left: 4, right: 12 }}>
                        <CartesianGrid horizontal={false} /><XAxis type="number" tickFormatter={(x) => x.toFixed(2)} /><YAxis type="category" dataKey="label" width={150} tick={{ fontSize: 10 }} />
                        <Tooltip {...tooltipStyle} formatter={(x: number) => [x.toFixed(4), 'Dorongan ke anomali']} />
                        <Bar dataKey="v" radius={4}>{shapData.map((s: any, i: number) => <Cell key={i} fill={s.v > 0 ? C.danger : C.teal} />)}</Bar>
                      </BarChart></ResponsiveContainer></div>
                      <div className="mt-2 flex gap-4 text-xs text-muted">
                        <span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-risk" />Mendorong skor naik</span>
                        <span><i className="mr-1.5 inline-block h-2 w-2 rounded-full bg-brand" />Menekan skor</span>
                      </div>
                    </>
                  )}
                </Panel>
              </div>

              <Panel title="Keputusan verifikator" hint="Setiap keputusan tercatat di audit trail" right={<span className="chip chip-ok">Status: {d.decision.state}</span>}>
                {d.allowed_actions.length === 0 ? (
                  <p className="text-sm text-muted">{d.status === 'Selaras' ? 'Klaim Selaras tidak memerlukan keputusan, dan dapat masuk Audit Acak 5%.' : `Peran ${user?.role} tidak memiliki aksi pada status ini.`}</p>
                ) : (
                  <>
                    <label className="block">
                      <span className="text-xs font-semibold">Catatan keputusan</span>
                      <textarea className="input mt-1 min-h-[4.6rem]" placeholder="Wajib (minimal 10 karakter) untuk Tolak, Pengecualian, dan Sanggahan. Dasar keputusan dicatat di audit trail." value={note} onChange={(e) => setNote(e.target.value)} />
                    </label>
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs tnum text-faint">{note.trim().length} karakter</span>
                      <div className="flex flex-wrap gap-2">{d.allowed_actions.map((a: string) => <button key={a} className={BTN[a] ?? 'btn-ghost'} onClick={() => decide(a)}>{a}</button>)}</div>
                    </div>
                  </>
                )}
                {msg && <div className="mt-3"><Alert kind={msg.kind}>{msg.text}</Alert></div>}

                {d.history.length > 0 && (
                  <div className="mt-5 border-t border-line pt-4">
                    <div className="mb-2.5 text-sm font-semibold">Jejak audit klaim ini</div>
                    <ol className="relative space-y-3 border-l border-line pl-4">
                      {d.history.slice(-6).map((h: any, i: number) => (
                        <li key={i} className="relative text-xs">
                          <span className="absolute -left-[1.3rem] top-1 h-2.5 w-2.5 rounded-full bg-brand ring-4 ring-surface" aria-hidden />
                          <div className="tnum text-faint">{utcToWib(h.ts)} WIB</div>
                          <div><b>{h.actor}</b> <span className="text-muted">({h.role})</span> · {h.action.replaceAll('_', ' ')}{h.detail ? <span className="text-muted"> · {h.detail}</span> : null}</div>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

              </Panel>
            </motion.div>
          </AnimatePresence>
        ))}
      </div>
    </div>
  )
}
