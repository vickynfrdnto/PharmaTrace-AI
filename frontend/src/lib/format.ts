export const num = (x: number | null | undefined, d = 0) =>
  x === null || x === undefined || Number.isNaN(x) ? '—' : x.toLocaleString('id-ID', { maximumFractionDigits: d, minimumFractionDigits: d })
export const pct = (x: number | null | undefined, d = 1) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(d).replace('.', ',')}%`)
export function rp(x: number | null | undefined) {
  if (x === null || x === undefined) return '—'
  const a = Math.abs(x)
  if (a >= 1e12) return `Rp ${(x / 1e12).toFixed(2).replace('.', ',')} T`
  if (a >= 1e9) return `Rp ${(x / 1e9).toFixed(2).replace('.', ',')} M`
  if (a >= 1e6) return `Rp ${(x / 1e6).toFixed(1).replace('.', ',')} jt`
  if (a >= 1e3) return `Rp ${(x / 1e3).toFixed(0)} rb`
  return `Rp ${Math.round(x)}`
}
export const secs = (x: number | null | undefined) => (x === null || x === undefined ? '—' : x < 1 ? `${Math.round(x * 1000)} ms` : `${x.toFixed(2).replace('.', ',')} s`)
export function utcToWib(value: string) {
  if (!value) return '—'
  const iso = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return value.replace('T', ' ')
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(date)
}
/** Warna seri grafik: mid-tone agar terbaca di tema terang maupun gelap. */
export const C = { lime: '#99CC44', teal: '#14A67C', danger: '#E04E42', amber: '#E39A0B', blue: '#4C8DF0', ink: '#0E2224', slate: '#7C8F8D' }
export const statusColor = (s: string) =>
  s === 'Perlu review verifikator' ? 'chip-risk' : s === 'Menunggu verifikasi faktur' ? 'chip-warn' : 'chip-ok'
export const diTone = (di: number) => (di >= 70 ? 'risk' : di >= 40 ? 'warn' : 'brand')
export const tooltipStyle = { contentStyle: { background: 'rgb(var(--surface))', border: '1px solid rgb(var(--line))', borderRadius: 10, fontSize: 12, color: 'rgb(var(--ink))', boxShadow: '0 12px 30px -12px rgb(0 0 0 / .35)' }, itemStyle: { color: 'rgb(var(--ink))' }, labelStyle: { color: 'rgb(var(--muted))', fontWeight: 600 } }
