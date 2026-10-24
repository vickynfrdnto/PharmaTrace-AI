import { useEffect, useState } from 'react'
import { ArrowRight, CheckCircle2, KeyRound, Lock, ShieldAlert } from 'lucide-react'
import { Alert, Loading, PageHeader, Panel, Section } from '../components/ui'
import { api } from '../lib/api'
import { useApp } from '../lib/app'
import { utcToWib } from '../lib/format'

export default function Privacy() {
  const { user } = useApp()
  const [ov, setOv] = useState<any>(null)
  const [val, setVal] = useState('3201010101010001')
  const [demo, setDemo] = useState<any>(null)
  const [trail, setTrail] = useState<any>(null)
  const [verify, setVerify] = useState<any>(null)
  const canTrail = user?.role !== 'Verifikator'
  useEffect(() => { api('/privacy/overview').then(setOv).catch(() => {}) }, [])
  useEffect(() => { const t = setTimeout(() => api('/privacy/demo', { json: { value: val } }).then(setDemo).catch(() => {}), 200); return () => clearTimeout(t) }, [val])
  const loadTrail = () => canTrail && api('/audit-trail?limit=25').then(setTrail).catch(() => {})
  useEffect(() => { loadTrail() }, [])
  const roles = ['Verifikator', 'Supervisor', 'Admin']
  return (
    <div className="space-y-5">
      <PageHeader title="Privasi & Tata Kelola" subtitle="Privacy by design sesuai UU No. 27 Tahun 2022: pseudonimisasi, minimisasi, kontrol peran, jejak yang tak bisa diubah." />
      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Pseudonimisasi HMAC-SHA-256" hint="Ketik NIK atau ID dokter sintetis, lihat apa yang masuk ke analitik">
          <input className="input" value={val} onChange={(e) => setVal(e.target.value)} placeholder="Ketik NIK / ID dokter sintetis" aria-label="Nilai yang dipseudonimkan" />
          {demo && (
            <div className="mt-3 grid items-stretch gap-2 sm:grid-cols-[1fr_auto_1fr]">
              <div className="well min-w-0 p-3"><div className="text-xs text-muted">Sebelum</div><code className="mt-1 block break-all text-sm text-risk">{demo.before}</code></div>
              <div className="grid place-items-center text-brand"><ArrowRight className="h-5 w-5 rotate-90 sm:rotate-0" /></div>
              <div className="min-w-0 rounded-xl bg-brand/10 p-3 ring-1 ring-brand/25"><div className="text-xs text-muted">Sesudah (masuk analitik)</div><code className="mt-1 block break-all text-sm text-brand">{demo.after}</code></div>
            </div>
          )}
          <p className="mt-3 text-xs leading-relaxed text-muted">Kunci rahasia dibaca dari environment variable <code className="text-ink">HMAC_SECRET</code>, tidak ditulis di kode. Fungsinya satu arah dan deterministik: pasien yang sama menghasilkan pseudonim yang sama, sehingga pola per pasien tetap bisa dihitung.</p>
          {ov && (
            <div className="mt-3 space-y-2 text-xs">
              <div className="flex flex-wrap items-center gap-2"><KeyRound className="h-4 w-4 text-brand" /> Sidik jari kunci: <code className="font-semibold text-brand">{ov.key_fingerprint}</code> <span className="text-muted">(bukan kuncinya)</span></div>
              {ov.key_is_default_demo && <Alert kind="warn" title="Kunci demo bawaan sedang dipakai">Setel HMAC_SECRET acak di .env sebelum pilot apa pun. Pseudonim dari kunci bawaan tidak boleh dianggap aman.</Alert>}
            </div>
          )}
        </Panel>
        <Panel title="Minimisasi data dan retensi">
          {!ov ? <Loading /> : (<>
            <div className="mb-3 flex flex-wrap gap-1.5">{ov.data_minimization.map((x: string) => <span key={x} className="chip chip-ok">{x}</span>)}</div>
            <ul className="space-y-2 text-sm">{Object.entries(ov.retention).map(([k, x]: any) => <li key={k} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand" /><span><b className="capitalize">{k.replaceAll('_', ' ')}:</b> <span className="text-muted">{x}</span></span></li>)}</ul>
            {ov.last_run_privacy && <div className="well mt-3 p-3 text-xs leading-relaxed text-muted">Run terakhir: {ov.last_run_privacy.unique_nik_pseudonymized.toLocaleString('id-ID')} NIK dan {ov.last_run_privacy.unique_doctor_pseudonymized.toLocaleString('id-ID')} ID dokter dipseudonimkan; kolom mentah dibuang sebelum analitik ({ov.last_run_privacy.purged_at?.replace('T', ' ')}).</div>}
            <p className="mt-2 text-xs text-faint">{ov.legal_basis}. Pilot nyata memerlukan izin resmi dan penilaian dampak (DPIA).</p>
          </>)}
        </Panel>
      </div>

      {ov && (
        <Section title="Kontrol akses berbasis peran" hint="Peran Anda ditandai">
          <div className="panel scroll-slim overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-sunken/60"><th className="th">Kemampuan</th>{roles.map((r) => <th key={r} className={`th ${r === user?.role ? '!text-brand' : ''}`}>{r}{r === user?.role ? ' (Anda)' : ''}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">{ov.role_matrix.map((m: any) => (
                <tr key={m.capability}><td className="td font-medium">{m.capability}</td>{roles.map((r) => <td key={r} className={`td ${m[r] === 'Tidak' ? 'text-faint' : r === user?.role ? 'font-semibold text-brand' : 'text-muted'}`}>{m[r]}</td>)}</tr>
              ))}</tbody>
            </table>
          </div>
        </Section>
      )}

      <Section title="Audit trail" hint="Append-only, berantai hash SHA-256" right={canTrail ? (
        <div className="flex flex-wrap items-center gap-2">
          {verify && <span className={`chip ${verify.valid ? 'chip-ok' : 'chip-risk'}`}>{verify.valid ? `Rantai utuh · ${verify.entries} entri` : `Rantai rusak pada #${verify.broken_at_id}`}</span>}
          <button className="btn-ghost btn-sm" onClick={() => api('/audit-trail/verify').then(setVerify)}><ShieldAlert className="h-3.5 w-3.5" /> Verifikasi integritas</button>
          <button className="btn-ghost btn-sm" onClick={loadTrail}>Muat ulang</button>
        </div>
      ) : undefined}>
        <div className="panel overflow-hidden">
          {!canTrail ? <p className="flex items-center gap-2 p-4 text-sm text-muted"><Lock className="h-4 w-4" /> Peran Verifikator hanya melihat riwayat per klaim di Claim Inspector, bukan audit trail penuh.</p> : !trail ? <div className="p-4"><Loading /></div> : (
            <div className="scroll-slim max-h-[22rem] overflow-auto"><table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface shadow-[0_1px_0_rgb(var(--line))]"><tr><th className="th">#</th><th className="th">Waktu (WIB)</th><th className="th">Aktor</th><th className="th">Aksi</th><th className="th">Objek</th><th className="th">Detail</th><th className="th">Hash</th></tr></thead>
              <tbody className="divide-y divide-line">{trail.items.map((t: any) => <tr key={t.id}><td className="px-3 py-1.5 tnum">{t.id}</td><td className="whitespace-nowrap px-3 py-1.5 tnum">{utcToWib(t.ts)}</td><td className="px-3 py-1.5">{t.actor} <span className="text-faint">({t.role})</span></td><td className="px-3 py-1.5 font-semibold">{t.action.replaceAll('_', ' ')}</td><td className="px-3 py-1.5">{t.claim_key ?? t.run_id ?? ''}</td><td className="max-w-[16rem] truncate px-3 py-1.5" title={t.detail}>{t.detail}</td><td className="px-3 py-1.5"><code className="text-faint">{t.hash}</code></td></tr>)}</tbody></table></div>
          )}
        </div>
      </Section>
    </div>
  )
}
