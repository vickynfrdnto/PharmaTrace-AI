/** Ekspor grafik Recharts (SVG) ke PNG, mengikuti tema aktif + judul, siap ditempel ke slide. */
const tok = (n: string) => `rgb(${getComputedStyle(document.documentElement).getPropertyValue(`--${n}`).trim().split(/\s+/).join(',')})`

export function exportChartPng(container: HTMLElement | null, title: string, filename: string) {
  const svg = container?.querySelector('svg.recharts-surface') as SVGSVGElement | null
  if (!svg) return
  const w = svg.clientWidth || 600
  const h = svg.clientHeight || 300
  const clone = svg.cloneNode(true) as SVGSVGElement
  // salin gaya hasil komputasi (warna dari CSS variabel tidak ikut ke gambar mandiri)
  const src = [svg, ...svg.querySelectorAll('*')]
  const dst = [clone, ...clone.querySelectorAll('*')]
  src.forEach((el, i) => {
    const cs = getComputedStyle(el)
    const d = dst[i] as SVGElement
    if (!d.getAttribute('fill') || d.getAttribute('fill')!.includes('var(')) d.setAttribute('fill', cs.fill)
    if (!d.getAttribute('stroke') || d.getAttribute('stroke')!.includes('var(')) d.setAttribute('stroke', cs.stroke)
    if (el.tagName === 'text') { d.setAttribute('font-size', cs.fontSize); d.setAttribute('font-family', cs.fontFamily) }
  })
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(w))
  clone.setAttribute('height', String(h))
  const xml = new XMLSerializer().serializeToString(clone)
  const img = new Image()
  img.onload = () => {
    const scale = 2
    const pad = 28
    const canvas = document.createElement('canvas')
    canvas.width = (w + pad * 2) * scale
    canvas.height = (h + pad * 2 + 30) * scale
    const ctx = canvas.getContext('2d')!
    ctx.scale(scale, scale)
    ctx.fillStyle = tok('surface')
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = tok('ink')
    ctx.font = '700 15px "Bricolage Grotesque Variable", system-ui, sans-serif'
    ctx.fillText(title, pad, pad)
    ctx.drawImage(img, pad, pad + 14, w, h)
    ctx.fillStyle = tok('faint')
    ctx.font = '11px "Onest Variable", system-ui, sans-serif'
    ctx.fillText('PharmaTrace-AI · Data Sintetis · dihitung dari run aktual', pad, h + pad + 34)
    canvas.toBlob((b) => {
      if (!b) return
      const a = document.createElement('a')
      a.href = URL.createObjectURL(b)
      a.download = filename
      a.click()
      URL.revokeObjectURL(a.href)
    })
  }
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml)
}
