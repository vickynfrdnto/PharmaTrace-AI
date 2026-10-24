import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis } from 'recharts'
import { Download } from 'lucide-react'
import { Alert, ChartCard, Empty, Loading, Meter, PageHeader, Panel, Section } from '../components/ui'
import { api, downloadFile } from '../lib/api'
import { useApp } from '../lib/app'
import { C, num, pct, tooltipStyle } from '../lib/format'

const pr = (c: any) => c.recall.map((r: number, i: number) => ({ recall: r, precision: c.precision[i] })).sort((a: any, b: any) => a.recall - b.recall)
const pp = (a: number, b: number) => {
  const v = (a - b) * 100
  return `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1).replace('.', ',')} pp`
}

function Matrix({ m, title, tone }: { m: any; title: string; tone: string }) {
  const [[tn, fp], [fn, tp]] = m.confusion_matrix
  const cell = (v: number, l: string, c: string) => (
    <div className={`rounded-xl p-3 text-center ${c}`}>
      <div className="font-num text-xl font-bold">{num(v)}</div>
      <div className="mt-0.5 text-xs text-muted">{l}</div>
    </div>
  )
  const head = 'text-center text-xs font-semibold text-muted'
  return (
    <Panel>
      <div className={`mb-3 font-display text-base font-semibold ${tone}`}>{title}</div>
      <div className="grid grid-cols-[3.4rem_1fr_1fr] items-stretch gap-1.5">
        <span />
        <span className={head}>Prediksi bersih</span>
        <span className={head}>Prediksi pola berlabel</span>
        <span className={`${head} self-center text-right`}>Label<br />bersih</span>
        {cell(tn, 'TN · lolos benar', 'bg-brand/12')}
        {cell(fp, 'FP · salah tandai', 'bg-warn/15')}
        <span className={`${head} self-center text-right`}>Label<br />pola sintetis</span>
        {cell(fn, 'FN · pola lolos', 'bg-risk/15')}
        {cell(tp, 'TP · terdeteksi', 'bg-brand/25')}
      </div>
    </Panel>
  )
}

function MethodCard({ label, desc, tone, primary, mm, nEval, nFraud }: { label: string; desc: string; tone: string; primary?: boolean; mm: any; nEval: number; nFraud: number }) {
  const tiles: [string, number, string][] = [
    ['Precision', mm.precision, 'rgb(var(--brand))'],
    ['Recall', mm.recall, 'rgb(var(--brand))'],
    ['F1', mm.f1, 'rgb(var(--brand))'],
    ['FPR', mm.fpr, 'rgb(var(--risk))'],
  ]
  return (
    <div className={`panel relative p-4 ${primary ? 'ring-2 ring-brand/50 shadow-glow' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className={`font-display text-lg font-semibold ${tone}`}>{label}</div>
          <div className="text-xs text-muted">{desc}</div>
        </div>
        {primary && <span className="chip chip-ok">Metode utama</span>}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-x-5 gap-y-4">
        {tiles.map(([l, v, col]) => (
          <div key={l}>
            <div className="flex items-baseline justify-between">
              <span className="text-xs font-medium text-muted">{l}</span>
              <span className="font-num text-lg font-bold">{pct(v)}</span>
            </div>
            <div className="mt-1.5"><Meter value={v * 100} color={col} /></div>
          </div>
        ))}
      </div>
      <div className="mt-4 border-t border-line pt-3 text-xs text-muted">
        Ditandai <span className="tnum font-semibold text-ink">{num(mm.flagged)}</span> dari <span className="tnum font-semibold text-ink">{num(nEval)}</span> klaim · pola injeksi berlabel <span className="tnum font-semibold text-ink">{num(nFraud)}</span>
      </div>
    </div>
  )
}

export default function Evaluation() {
  const { run } = useApp()
  const [ev, setEv] = useState<any>(null)
  const [err, setErr] = useState('')
  const [downloadErr, setDownloadErr] = useState('')
  useEffect(() => { if (run) api('/runs/latest/evaluation').then(setEv).catch((e) => setErr(e.message)) }, [run?.id])

  if (!run) return <Empty title="Belum ada hasil audit" hint="Evaluasi dihitung dari run berlabel. Jalankan audit dulu." action={<Link to="/audit" className="btn-primary">Ke Upload & Audit</Link>} />
  if (err) return <div><PageHeader title="Evaluasi Model" /><Alert kind="error" title="Evaluasi tidak dapat dimuat">{err}</Alert></div>
  if (ev && !ev.available) return <div><PageHeader title="Evaluasi Model" /><Alert kind="warn" title="Metrik belum tersedia">{ev.reason}</Alert></div>
  if (!ev) return <div><PageHeader title="Evaluasi Model" /><Loading text="Memuat evaluasi" /></div>

  const m = ev.metrics
  const scen = m.by_scenario.map((s: any) => ({ name: `${s.scenario} · ${s.variant}`, n: s.n, Rule: +(s.recall_rules * 100).toFixed(1), Hibrida: +(s.recall_hybrid * 100).toFixed(1) }))
  const cfg = run.summary.config
  const gain = [
    ['Recall', pp(m.hybrid.recall, m.rule_only.recall), m.hybrid.recall - m.rule_only.recall >= 0],
    ['Precision', pp(m.hybrid.precision, m.rule_only.precision), m.hybrid.precision - m.rule_only.precision >= 0],
    ['F1', pp(m.hybrid.f1, m.rule_only.f1), m.hybrid.f1 - m.rule_only.f1 >= 0],
  ] as const

  return (
    <div className="space-y-6">
      <PageHeader title="Evaluasi Model" subtitle="Dihitung dari label sintetis, bukan data JKN riil. Kelemahan dilaporkan apa adanya.">
        <button className="btn-primary" onClick={() => downloadFile(`/runs/${run.id}/evaluation/export.csv`).catch((e) => setDownloadErr((e as Error).message))}><Download className="h-4 w-4" /> Ekspor hasil (CSV)</button>
      </PageHeader>
      {downloadErr && <Alert kind="error" title="Ekspor gagal">{downloadErr}</Alert>}

      <Section
        title="Perbandingan metode"
        hint="Precision, recall, F1, dan false positive rate pada seluruh klaim yang dievaluasi"
        right={
          <div className="hidden items-center gap-1.5 sm:flex">
            <span className="text-xs text-muted">Hibrida vs rule-only</span>
            {gain.map(([l, v, up]) => <span key={l} className={`chip tnum ${up ? 'chip-ok' : 'chip-risk'}`}>{l} {v}</span>)}
          </div>
        }
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <MethodCard label="Naif" desc="Klaim lebih besar dari RME" tone="" mm={m.naive} nEval={m.n_evaluated} nFraud={m.n_fraud} />
          <MethodCard label="Rule-only" desc="Aturan deterministik" tone="text-warn" mm={m.rule_only} nEval={m.n_evaluated} nFraud={m.n_fraud} />
          <MethodCard label="Hibrida" desc="Aturan + IsolationForest" tone="text-brand" primary mm={m.hybrid} nEval={m.n_evaluated} nFraud={m.n_fraud} />
        </div>
      </Section>

      <Section title="Kinerja mendalam" hint="Kurva PR, recall per skenario, dan pemantauan bias antar kelas faskes">
        <div className="grid gap-4 xl:grid-cols-3">
          <ChartCard title="Kurva precision–recall" sub={`AP hibrida ${m.pr.hybrid.average_precision.toFixed(3)} · AP rule ${m.pr.rule_only.average_precision.toFixed(3)} · AP ML saja ${m.pr.ml_only.average_precision.toFixed(3)}`} png="pr-curve">
            <div className="h-[17rem]"><ResponsiveContainer><ComposedChart margin={{ left: -10, right: 8 }}>
              <CartesianGrid strokeDasharray="3 3" /><XAxis type="number" dataKey="recall" domain={[0, 1]} tickFormatter={(v) => v.toFixed(1)} label={{ value: 'Recall', position: 'insideBottom', offset: -2, fill: 'rgb(var(--muted))', fontSize: 11 }} />
              <YAxis type="number" dataKey="precision" domain={[0, 1]} tickFormatter={(v) => v.toFixed(1)} /><Tooltip {...tooltipStyle} formatter={(v: number) => v.toFixed(3)} /><Legend wrapperStyle={{ fontSize: 11 }} />
              <Line data={pr(m.pr.hybrid)} dataKey="precision" name="Hibrida (DI)" stroke={C.teal} dot={false} strokeWidth={2.5} type="monotone" />
              <Line data={pr(m.pr.rule_only)} dataKey="precision" name="Rule-only" stroke={C.amber} dot={false} strokeWidth={2} type="monotone" />
              <Line data={pr(m.pr.ml_only)} dataKey="precision" name="ML saja" stroke={C.blue} dot={false} strokeWidth={1.5} strokeDasharray="4 3" type="monotone" />
              <Scatter name="Naif (satu titik)" data={[{ recall: m.pr.naive.recall, precision: m.pr.naive.precision }]} fill={C.slate} />
            </ComposedChart></ResponsiveContainer></div>
          </ChartCard>
          <ChartCard title="Recall per skenario sintetis (%)" sub="Varian subtle dan collusive sengaja sulit; hasil bukan performa di dunia nyata" png="recall-skenario">
            <div className="h-[17rem]"><ResponsiveContainer><BarChart data={scen} margin={{ left: -15, bottom: 38 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" /><XAxis dataKey="name" angle={-35} textAnchor="end" interval={0} tick={{ fontSize: 9 }} /><YAxis domain={[0, 100]} /><Tooltip {...tooltipStyle} /><Legend wrapperStyle={{ fontSize: 11 }} verticalAlign="top" />
              <Bar dataKey="Rule" fill={C.amber} radius={[4, 4, 0, 0]} /><Bar dataKey="Hibrida" fill={C.teal} radius={[4, 4, 0, 0]} />
            </BarChart></ResponsiveContainer></div>
          </ChartCard>
          <ChartCard title="False positive rate per kelas faskes" sub="Hibrida · pantau bias pada faskes kecil" png="fpr-kelas">
            <div className="h-[17rem]"><ResponsiveContainer><BarChart data={m.fpr_by_peer_class.map((x: any) => ({ name: x.peer_class, FPR: +(x.fpr * 100).toFixed(2), FP: x.fp, n: x.n_clean }))} margin={{ left: -15 }}>
              <CartesianGrid vertical={false} strokeDasharray="3 3" /><XAxis dataKey="name" tick={{ fontSize: 10 }} /><YAxis unit="%" /><Tooltip {...tooltipStyle} formatter={(v: number, _n: string, p: any) => [`${v}% (${p.payload.FP}/${p.payload.n})`, 'FPR']} />
              <Bar dataKey="FPR" fill={C.danger} radius={[5, 5, 0, 0]} />
            </BarChart></ResponsiveContainer></div>
          </ChartCard>
        </div>
      </Section>

      <Section title="Kesalahan klasifikasi dan ambang DI" hint="Confusion matrix dan trade-off ambang Discrepancy Index">
        <div className="grid gap-4 lg:grid-cols-[1fr_1fr_1.35fr]">
          <Matrix m={m.rule_only} title="Rule-only" tone="text-warn" />
          <Matrix m={m.hybrid} title="Hibrida" tone="text-brand" />
          <Panel title="Kontribusi ML dan trade-off ambang">
            <p className="text-xs leading-relaxed text-muted">
              ML menambah <b className="text-brand">{m.ml_contribution.extra_tp}</b> pola sintetis berlabel yang lolos aturan, dengan <b className="text-warn">{m.ml_contribution.extra_fp}</b> salah tandai tambahan (dari {m.ml_contribution.ml_only_total} klaim ML-only).
            </p>
            <div className="scroll-slim mt-3 overflow-x-auto rounded-xl ring-1 ring-line">
              <table className="w-full text-xs tnum">
                <thead><tr className="bg-sunken/70"><th className="th">Ambang DI</th><th className="th">Precision</th><th className="th">Recall</th><th className="th">F1</th><th className="th text-right">Ditandai</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {m.threshold_sweep.map((t: any) => {
                    const active = t.di_threshold === cfg.di_threshold
                    return (
                      <tr key={t.di_threshold} className={active ? 'bg-brand/10 font-semibold text-brand' : ''}>
                        <td className="px-3 py-1.5">{t.di_threshold}{active && <span className="chip chip-ok ml-1.5 !py-0">aktif</span>}</td>
                        <td className="px-3 py-1.5">{pct(t.precision)}</td><td className="px-3 py-1.5">{pct(t.recall)}</td><td className="px-3 py-1.5">{pct(t.f1)}</td><td className="px-3 py-1.5 text-right">{num(t.flagged)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-3 text-xs leading-relaxed text-muted">Sumber salah-tandai (rule): {m.fp_by_rule.map((x: any) => `${x.rule} ${x.n}`).join(' · ') || '—'}</div>
          </Panel>
        </div>
      </Section>

      <Alert kind="info" title="Batasan evaluasi">
        Label dihasilkan generator dan disimpan terpisah; engine tidak melihat label saat inferensi. Angka pada data riil bisa berbeda jauh dan harus diuji pada tahap pilot.
      </Alert>
    </div>
  )
}
