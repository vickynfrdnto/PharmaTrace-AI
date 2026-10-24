import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Alert, ChartCard, Field, PageHeader, Panel, Stat, StatGrid } from '../components/ui'
import { api } from '../lib/api'
import { C, pct, rp, tooltipStyle } from '../lib/format'

export default function Impact() {
  const [lowT, setLowT] = useState(31.7)
  const [highT, setHighT] = useState(39.7)
  const [leakLow, setLeakLow] = useState(1)
  const [leakHigh, setLeakHigh] = useState(3)
  const [prev, setPrev] = useState(30)
  const [src, setSrc] = useState('hybrid')
  const [res, setRes] = useState<{ low: any; high: any } | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const [low, high] = await Promise.all([
          api('/impact', { json: { claims_drugs_alkes: lowT * 1e12, leakage_pct: leakLow, prevention_pct: prev, recall_source: src } }),
          api('/impact', { json: { claims_drugs_alkes: highT * 1e12, leakage_pct: leakHigh, prevention_pct: prev, recall_source: src } }),
        ])
        setRes({ low, high }); setErr('')
      } catch (e) { setRes(null); setErr((e as Error).message) }
    }, 250)
    return () => clearTimeout(t)
  }, [lowT, highT, leakLow, leakHigh, prev, src])
  const recall = res?.low.recall_actual
  const target = 0.92
  const alt = (v: number, t: number, l: number) => t * 1e12 * (l / 100) * v * (prev / 100)
  const term = 'rounded-lg bg-sunken px-2.5 py-1 text-sm font-semibold'
  return (
    <div>
      <PageHeader title="Kalkulator Dampak" subtitle="Estimasi berbasis asumsi. Recall selalu diambil dari evaluasi nyata, tidak bisa diketik.">
        <span className="chip chip-warn">Estimasi, bukan hasil terukur</span>
      </PageHeader>

      <div className="panel mb-4 flex flex-wrap items-center gap-x-2 gap-y-2 p-3.5 text-sm">
        <span className="mr-1 font-display text-base font-bold">Hemat</span><span className="text-faint">=</span>
        <span className={term}>Klaim obat &amp; alkes</span><span className="text-faint">×</span>
        <span className={term}>% kebocoran</span><span className="text-faint">×</span>
        <span className="rounded-lg bg-brand px-2.5 py-1 text-sm font-semibold text-onbrand">recall dari evaluasi nyata</span><span className="text-faint">×</span>
        <span className={term}>% pencegahan pre-payment</span>
      </div>
      {err && <div className="mb-3"><Alert kind="warn" title="Recall nyata belum tersedia">{err} <Link to="/audit" className="font-semibold underline">Jalankan audit</Link></Alert></div>}

      <div className="grid gap-4 xl:grid-cols-[24rem_1fr]">
        <Panel title="Asumsi" hint="Ubah angka, hasil mengikuti">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Klaim bawah (Rp T)"><input className="input" type="number" step="0.1" value={lowT} onChange={(e) => setLowT(+e.target.value)} /></Field>
            <Field label="Klaim atas (Rp T)"><input className="input" type="number" step="0.1" value={highT} onChange={(e) => setHighT(+e.target.value)} /></Field>
            <Field label="% kebocoran bawah"><input className="input" type="number" step="0.1" value={leakLow} onChange={(e) => setLeakLow(+e.target.value)} /></Field>
            <Field label="% kebocoran atas"><input className="input" type="number" step="0.1" value={leakHigh} onChange={(e) => setLeakHigh(+e.target.value)} /></Field>
            <div className="col-span-2">
              <Field label={`Pencegahan pre-payment: ${prev}%`}>
                <input type="range" min={0} max={100} value={prev} onChange={(e) => setPrev(+e.target.value)} className="h-1.5 w-full cursor-pointer accent-[rgb(var(--brand))]" aria-label="Persen pencegahan pre-payment" />
              </Field>
            </div>
            <div className="col-span-2">
              <Field label="Sumber recall"><select className="input" value={src} onChange={(e) => setSrc(e.target.value)}><option value="hybrid">Hibrida</option><option value="rule_only">Rule-only</option></select></Field>
            </div>
          </div>
          <div className="well mt-3 p-3 text-xs leading-relaxed text-muted">Recall <b className="text-brand">tidak dapat diketik</b>: selalu diambil dari evaluasi run berlabel terakhir{res ? ` (run ${res.low.recall_run_id})` : ''}.</div>
        </Panel>

        <div className="min-w-0 space-y-4">
          <StatGrid cols="grid-cols-1 sm:grid-cols-3">
            <Stat label="Recall terukur (sintetis)" tone="brand" value={recall !== undefined ? pct(recall) : '—'} sub={`Target proposal ${pct(target, 0)}${recall !== undefined ? ' · ' + (recall >= target ? 'tercapai di data sintetis' : 'belum mencapai target') : ''}`} />
            <Stat label="Estimasi hemat · bawah" tone="brand" value={res ? rp(res.low.estimate_rupiah) : '—'} sub="per tahun" />
            <Stat label="Estimasi hemat · atas" tone="brand" value={res ? rp(res.high.estimate_rupiah) : '—'} sub="per tahun" />
          </StatGrid>
          {res && (
            <ChartCard title="Estimasi hemat per tahun (Rp miliar)" sub="Recall terukur dibanding recall target proposal (92%)" png="dampak">
              <div className="h-[16rem]"><ResponsiveContainer><BarChart data={[
                { name: 'Bawah · terukur', v: res.low.estimate_rupiah / 1e9 }, { name: 'Atas · terukur', v: res.high.estimate_rupiah / 1e9 },
                { name: 'Bawah · target 92%', v: alt(target, lowT, leakLow) / 1e9 }, { name: 'Atas · target 92%', v: alt(target, highT, leakHigh) / 1e9 }]} margin={{ left: -5 }}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" /><XAxis dataKey="name" tick={{ fontSize: 10 }} /><YAxis /><Tooltip {...tooltipStyle} formatter={(v: number) => [`Rp ${v.toFixed(1)} M`, 'Estimasi']} />
                <Bar dataKey="v" radius={[6, 6, 0, 0]}>{[C.teal, C.teal, C.slate, C.slate].map((c, i) => <Cell key={i} fill={c} fillOpacity={i > 1 ? 0.55 : 1} />)}</Bar>
              </BarChart></ResponsiveContainer></div>
            </ChartCard>
          )}
          <Alert kind="warn" title="Batasan">{res?.low.caveat ?? 'Recall diukur pada data sintetis.'} Seluruh angka rupiah adalah estimasi berbasis asumsi (BPJS 2023, KPK 2020, BPK 2022; perlu verifikasi sebelum submit), bukan hasil terukur.</Alert>
        </div>
      </div>
    </div>
  )
}
