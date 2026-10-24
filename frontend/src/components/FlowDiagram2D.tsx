/**
 * Fallback ringan (tanpa WebGL) saat "Kurangi animasi/3D" aktif.
 * Tampilan pseudo-3D: balok isometrik berlapis kaca, pipa tabung bercahaya,
 * engine bola mengambang di atas platform, lantai perspektif + bayangan lembut.
 * Statis (tanpa animasi) agar tetap patuh pada preferensi "kurangi animasi".
 */

const DX = 16 // kedalaman ke kanan
const DY = 12 // kedalaman ke atas

type BlockProps = {
  id: string
  x: number
  y: number
  c: string
  title: string
  sub: string
  subColor?: string
  w?: number
  h?: number
}

function Block({ id, x, y, c, title, sub, subColor = '#cbd5e1', w = 176, h = 60 }: BlockProps) {
  const top = `${x},${y} ${x + DX},${y - DY} ${x + w + DX},${y - DY} ${x + w},${y}`
  const side = `${x + w},${y} ${x + w + DX},${y - DY} ${x + w + DX},${y + h - DY} ${x + w},${y + h}`
  return (
    <g>
      {/* bayangan lantai */}
      <ellipse cx={x + w / 2 + DX / 2} cy={y + h + 14} rx={w / 2 + 8} ry="7" fill="#000" opacity=".45" filter="url(#fd-blur)" />
      {/* sisi kanan (gelap) */}
      <polygon points={side} fill="#050B14" />
      <polygon points={side} fill={c} fillOpacity=".28" stroke={c} strokeOpacity=".5" strokeWidth=".8" />
      {/* sisi atas (terang) */}
      <polygon points={top} fill="#0B1522" />
      <polygon points={top} fill={`url(#fd-${id}-top)`} stroke={c} strokeOpacity=".8" strokeWidth=".8" />
      {/* muka depan (kaca) */}
      <rect x={x} y={y} width={w} height={h} rx="5" fill="#0B1522" />
      <rect x={x} y={y} width={w} height={h} rx="5" fill={`url(#fd-${id}-front)`} stroke={c} strokeOpacity=".9" strokeWidth="1" />
      {/* kilau tepi atas */}
      <line x1={x + 6} y1={y + 1} x2={x + w - 6} y2={y + 1} stroke="#fff" strokeOpacity=".55" strokeWidth="1" />
      <rect x={x + 1} y={y + 1} width={w * 0.45} height={h - 2} rx="4" fill="url(#fd-gloss)" />
      {/* indikator */}
      <circle cx={x + 16} cy={y + h / 2} r="5" fill={c} filter="url(#fd-glow)" />
      <circle cx={x + 16} cy={y + h / 2} r="2" fill="#fff" fillOpacity=".9" />
      <text x={x + 32} y={y + 26} fill="#fff" fontSize="13" fontWeight="700">{title}</text>
      <text x={x + 32} y={y + 44} fill={subColor} fontSize="11">{sub}</text>
      <defs>
        <linearGradient id={`fd-${id}-front`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={c} stopOpacity=".55" />
          <stop offset="1" stopColor={c} stopOpacity=".12" />
        </linearGradient>
        <linearGradient id={`fd-${id}-top`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor={c} stopOpacity=".55" />
          <stop offset="1" stopColor="#fff" stopOpacity=".55" />
        </linearGradient>
      </defs>
    </g>
  )
}

function Pipe({ d, c, id }: { d: string; c: string; id: string }) {
  return (
    <g>
      <path d={d} fill="none" stroke="#000" strokeOpacity=".5" strokeWidth="13" strokeLinecap="round" transform="translate(0 6)" filter="url(#fd-blur)" />
      <path d={d} fill="none" stroke="#050B14" strokeWidth="11" strokeLinecap="round" />
      <path d={d} fill="none" stroke={c} strokeOpacity=".9" strokeWidth="7" strokeLinecap="round" filter="url(#fd-glow)" />
      <path d={d} fill="none" stroke={`url(#fd-tube-${id})`} strokeWidth="7" strokeLinecap="round" />
      <path d={d} fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth="1.4" strokeLinecap="round" transform="translate(0 -2)" />
      <defs>
        <linearGradient id={`fd-tube-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".35" />
          <stop offset=".5" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity=".4" />
        </linearGradient>
      </defs>
    </g>
  )
}

export default function FlowDiagram2D({ flagged, total }: { flagged?: number; total?: number }) {
  const fmt = (n: number) => n.toLocaleString('id-ID')
  const ok = total ? `${fmt(total - (flagged ?? 0))} klaim` : '—'
  const bad = total ? `${fmt(flagged ?? 0)} ter-flag` : '—'

  return (
    <svg viewBox="0 0 780 380" className="h-full w-full" role="img" aria-label="Alur rekonsiliasi tiga pintu menuju engine, lalu sesuai atau verifikator" fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif">
      <defs>
        <filter id="fd-blur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="5" /></filter>
        <filter id="fd-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3.5" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <radialGradient id="fd-aura" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#99CC44" stopOpacity=".28" />
          <stop offset=".6" stopColor="#1E9970" stopOpacity=".10" />
          <stop offset="1" stopColor="#1E9970" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="fd-floorfade" cx="50%" cy="40%" r="60%">
          <stop offset="0" stopColor="#fff" />
          <stop offset="1" stopColor="#000" />
        </radialGradient>
        <mask id="fd-floormask"><rect width="780" height="380" fill="url(#fd-floorfade)" /></mask>
        <linearGradient id="fd-gloss" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity=".18" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="fd-sphere" cx="34%" cy="28%" r="75%">
          <stop offset="0" stopColor="#E6FF9E" />
          <stop offset=".3" stopColor="#99CC44" />
          <stop offset=".65" stopColor="#1E9970" />
          <stop offset="1" stopColor="#052E24" />
        </radialGradient>
        <linearGradient id="fd-platform" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#0B2A22" />
          <stop offset=".5" stopColor="#1E9970" stopOpacity=".7" />
          <stop offset="1" stopColor="#06150F" />
        </linearGradient>
      </defs>

      {/* Lantai perspektif */}
      <g mask="url(#fd-floormask)" stroke="#99CC44" strokeOpacity=".28" strokeWidth=".8" fill="none">
        {[-6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6].map((i) => (
          <line key={`v${i}`} x1={390 + i * 38} y1="296" x2={390 + i * 120} y2="380" />
        ))}
        {[296, 308, 322, 340, 362].map((y) => <line key={`h${y}`} x1="0" y1={y} x2="780" y2={y} />)}
      </g>

      {/* Aura di belakang engine */}
      <circle cx="400" cy="180" r="150" fill="url(#fd-aura)" />

      {/* Pipa */}
      <Pipe id="a" c="#4C9AFF" d="M214,74 C284,74 276,180 338,180" />
      <Pipe id="b" c="#1E9970" d="M214,180 L338,180" />
      <Pipe id="c" c="#FFB020" d="M214,286 C284,286 276,180 338,180" />
      <Pipe id="d" c="#99CC44" d="M462,180 C520,180 520,90 580,90" />
      <Pipe id="e" c="#FF6B5E" d="M462,180 C520,180 520,282 580,282" />

      {/* Ujung panah */}
      <polygon points="580,83 594,90 580,97" fill="#99CC44" filter="url(#fd-glow)" />
      <polygon points="580,275 594,282 580,289" fill="#FF6B5E" filter="url(#fd-glow)" />

      {/* Input: tiga pintu */}
      <Block id="p1" x={24} y={44} c="#4C9AFF" title="Pintu 1" sub="Procurement" />
      <Block id="p2" x={24} y={150} c="#1E9970" title="Pintu 2" sub="RME" />
      <Block id="p3" x={24} y={256} c="#FFB020" title="Pintu 3" sub="Klaim" />

      {/* Engine: platform silinder + bola mengambang */}
      <ellipse cx="400" cy="272" rx="92" ry="20" fill="#000" opacity=".5" filter="url(#fd-blur)" />
      <path d="M312,246 L312,258 A88,20 0 0 0 488,258 L488,246 Z" fill="url(#fd-platform)" />
      <ellipse cx="400" cy="246" rx="88" ry="20" fill="#0B2A22" stroke="#99CC44" strokeOpacity=".7" />
      <ellipse cx="400" cy="246" rx="62" ry="13" fill="none" stroke="#99CC44" strokeOpacity=".4" />
      <ellipse cx="400" cy="246" rx="40" ry="8" fill="#99CC44" fillOpacity=".25" filter="url(#fd-glow)" />

      <ellipse cx="400" cy="180" rx="84" ry="22" fill="none" stroke="#99CC44" strokeOpacity=".35" transform="rotate(-18 400 180)" />
      <circle cx="400" cy="180" r="52" fill="#99CC44" fillOpacity=".25" filter="url(#fd-blur)" />
      <circle cx="400" cy="180" r="48" fill="url(#fd-sphere)" stroke="#CFF08A" strokeOpacity=".6" />
      <ellipse cx="384" cy="160" rx="22" ry="12" fill="#fff" fillOpacity=".35" transform="rotate(-28 384 160)" />
      <ellipse cx="400" cy="180" rx="84" ry="22" fill="none" stroke="#99CC44" strokeWidth="1.6" strokeDasharray="190 400" strokeDashoffset="-250" transform="rotate(-18 400 180)" filter="url(#fd-glow)" />
      <text x="400" y="177" textAnchor="middle" fill="#fff" fontSize="14" fontWeight="800">Engine</text>
      <text x="400" y="194" textAnchor="middle" fill="#E6FF9E" fontSize="10.5">rekonsiliasi</text>

      {/* Output */}
      <Block id="ok" x={582} y={60} c="#1E9970" title="Sesuai" sub={ok} subColor="#a7f3d0" w={164} />
      <Block id="bad" x={582} y={252} c="#FF6B5E" title="Verifikator" sub={bad} subColor="#fecaca" w={164} />
    </svg>
  )
}