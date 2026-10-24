import { Activity, BarChart3, Calculator, DatabaseZap, Grid3x3, Home, Search, ShieldCheck, Shuffle, type LucideIcon } from 'lucide-react'

export interface NavItem { to: string; label: string; short: string; icon: LucideIcon; hint: string }
export const NAV_GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: 'Ikhtisar',
    items: [{ to: '/', label: 'Beranda', short: 'Beranda', icon: Home, hint: 'Ringkasan eksekutif dan alur triangulasi' }],
  },
  {
    title: 'Alur kerja audit',
    items: [
      { to: '/audit', label: 'Upload & Audit', short: 'Audit', icon: DatabaseZap, hint: 'Muat data tiga pintu dan jalankan audit' },
      { to: '/heatmap', label: 'Heatmap Selisih', short: 'Heatmap', icon: Grid3x3, hint: 'Selisih pengadaan vs klaim per faskes' },
      { to: '/inspector', label: 'Claim Inspector', short: 'Inspector', icon: Search, hint: 'Tinjau klaim dan ambil keputusan' },
    ],
  },
  {
    title: 'Bukti & kualitas',
    items: [
      { to: '/evaluasi', label: 'Evaluasi Model', short: 'Evaluasi', icon: BarChart3, hint: 'Precision, recall, dan perbandingan metode' },
      { to: '/audit-acak', label: 'Audit Acak 5%', short: 'Audit acak', icon: Shuffle, hint: 'Sampel klaim lolos otomatis' },
      { to: '/validasi', label: 'Validasi Data', short: 'Validasi', icon: Activity, hint: 'Uji statistik dan konsistensi data' },
    ],
  },
  {
    title: 'Dampak & tata kelola',
    items: [
      { to: '/dampak', label: 'Kalkulator Dampak', short: 'Dampak', icon: Calculator, hint: 'Estimasi penghematan per tahun' },
      { to: '/privasi', label: 'Privasi & Tata Kelola', short: 'Privasi', icon: ShieldCheck, hint: 'Pseudonimisasi, RBAC, audit trail' },
    ],
  },
]
export const NAV_ALL = NAV_GROUPS.flatMap((g) => g.items)
export const NAV_MOBILE = ['/', '/audit', '/heatmap', '/inspector']

const GLOBAL_REPORTS = new Set(['/evaluasi', '/validasi', '/dampak'])
export function navGroupsForUser(user: { facilities?: string[] | null } | null) {
  if (!user?.facilities) return NAV_GROUPS
  return NAV_GROUPS.map((group) => ({ ...group, items: group.items.filter((item) => !GLOBAL_REPORTS.has(item.to)) }))
    .filter((group) => group.items.length > 0)
}

export function navItemsForUser(user: { facilities?: string[] | null } | null) {
  return navGroupsForUser(user).flatMap((group) => group.items)
}
