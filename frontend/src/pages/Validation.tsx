import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Alert, ChartCard, Empty, Loading, PageHeader, Panel, Stat, StatGrid } from '../components/ui'
import { api } from '../lib/api'
import { useApp } from '../lib/app'
import { C, num, tooltipStyle } from '../lib/format'

export default function Validation() {
  const { run } = useApp()
  const [d, setD] = useState<any>(null)
  const [err, setErr] = useState('')
  useEffect(() => { if (run) api('/runs/latest/validation').then(setD).catch((e) => setErr(e.message)) }, [run?.id])
  if (!run) return <Empty title="Belum ada hasil audit" hint="Validasi dihitung dari data pada run terakhir." action={<Link to="/audit" className="btn-primary">Ke Upload & Audit</Link>} />
  if (err) return <div><PageHeader title="Validasi Data Sintetis" /><Alert kind="error" title="Validasi tidak dapat dimuat">{err}</Alert></div>
  if (!d) return <div><PageHeader title="Validasi Data Sintetis" /><Loading /></div>
  const v = d.validation, g = d.generator, tgt = v.counts.target_per_door
  const rows = [['Procurement (CSV)', v.counts.procurement, 'baris'], ['RME (FHIR-like JSON)', v.counts.rme_medication_administration, 'MedicationAdministration'], ['Klaim VEDIKA (CSV)', v.counts.claims, 'baris']]
  const row = 'flex justify-between gap-3 border-t border-line py-1.5 first:border-0'
  return (
    <div className="space-y-4">
      <PageHeader title="Validasi Data Sintetis" subtitle="Uji statistik dan konsistensi lintas pintu terhadap acuan desain generator." />
      <StatGrid cols="grid-cols-2 lg:grid-cols-4">
        {rows.map(([l, n, u]) => <Stat key={l as string} label={l as string} tone="brand" count={n as number} sub={`${u}${tgt ? ` · target ${num(tgt)}` : ''}`} />)}
        <Stat label="Pola sintetis berlabel" tone="risk" value={v.injected ? `${v.injected.fraud_pct.toFixed(1).replace('.', ',')}%` : '—'} sub={v.injected ? `${num(v.injected.fraud_lines)} baris berlabel (disimpan terpisah)` : 'tanpa label'} />
      </StatGrid>
      {g?.rme_filler_non_jkn > 0 && <p className="text-xs text-muted">RME memuat {num(g.rme_filler_non_jkn)} pemberian obat non-JKN sebagai pengisi agar jumlah record sesuai target; baris ini diabaikan saat pencocokan klaim.</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        {v.chi_square.map((t: any, i: number) => {
          const data = t.labels.map((l: string, k: number) => ({ name: l, Observasi: t.observed[k], Acuan: Math.round(t.expected[k]) }))
          const sig = t.p_value < 0.05
          return (
            <ChartCard key={i} title={`Uji chi-square: ${t.name}`} sub={`χ² = ${t.statistic.toFixed(1)} · dof ${t.dof} · p = ${t.p_value < 0.0001 ? '<0,0001' : t.p_value.toFixed(4)} · ukuran efek w = ${t.effect_size_w.toFixed(2)}`} png={`chi-square-${i + 1}`}>
              <div className="h-[12.5rem]"><ResponsiveContainer><BarChart data={data} margin={{ left: -10 }}><CartesianGrid vertical={false} strokeDasharray="3 3" /><XAxis dataKey="name" tick={{ fontSize: 10 }} /><YAxis /><Tooltip {...tooltipStyle} /><Legend wrapperStyle={{ fontSize: 11 }} /><Bar dataKey="Observasi" fill={C.teal} radius={[4, 4, 0, 0]} /><Bar dataKey="Acuan" fill={C.slate} fillOpacity={0.6} radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>
              <p className={`mt-1.5 text-xs leading-relaxed ${sig ? 'text-warn' : 'text-brand'}`}>{sig ? `p < 0,05: ada penyimpangan signifikan dari acuan desain${t.effect_size_w < 0.1 ? ' (efek praktis kecil)' : t.effect_size_w < 0.3 ? ' (efek kecil sampai sedang)' : ' (efek besar)'}.` : 'p ≥ 0,05: tidak ada bukti penyimpangan dari acuan desain.'} <span className="text-muted">Ini uji konsistensi internal terhadap distribusi acuan generator, bukan klaim bahwa data mewakili populasi JKN.</span></p>
            </ChartCard>
          )
        })}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Konsistensi lintas tiga pintu">
          <ul className="text-sm">
            <li className={row}><span className="text-muted">Klaim dengan kunjungan di RME</span><b className="tnum">{v.cross_door.claims_with_rme_encounter_pct.toFixed(1)}%</b></li>
            <li className={row}><span className="text-muted">Klaim dengan catatan pemberian obat</span><b className="tnum">{v.cross_door.claims_with_rme_medication_pct.toFixed(1)}%</b></li>
            <li className={row}><span className="text-muted">Klaim dengan pengadaan faskes×obat sama</span><b className="tnum">{v.cross_door.claims_with_any_procurement_pct.toFixed(1)}%</b></li>
            <li className={row}><span className="text-muted">Nama obat tidak terpetakan</span><b className="tnum">{v.cross_door.unmapped_claim_names}</b></li>
          </ul>
          <div className="mt-2 text-xs text-faint">Periode klaim {v.period.claims[0]} → {v.period.claims[1]} · pengadaan {v.period.procurement[0]} → {v.period.procurement[1]}</div>
        </Panel>
        <Panel title="Normalisasi nama (Kamus KFA)">
          <ul className="text-sm">{Object.entries(v.cross_door.name_mapping).map(([door, m]: any) => <li key={door} className={row}><span className="capitalize text-muted">{door}</span><span className="tnum text-xs">tepat {num(m.exact ?? 0)} · fuzzy {num(m.fuzzy ?? 0)} · gagal {num(m.unmapped ?? 0)}</span></li>)}</ul>
        </Panel>
        <Panel title="“Jebakan jujur” yang teramati">
          <ul className="text-sm">{Object.entries(v.traps_observed).map(([k, x]: any) => <li key={k} className={row}><span className="text-muted">{k.replaceAll('_', ' ')}</span><b className="tnum">{num(x)}</b></li>)}</ul>
        </Panel>
      </div>
      {v.injected && <Alert kind="info" title="Skenario sintetis berlabel (label terpisah)">{Object.entries(v.injected.by_scenario).map(([k, x]: any) => `${k}: ${num(x)}`).join(' · ')}</Alert>}
    </div>
  )
}
