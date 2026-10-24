export class ApiError extends Error {
  status: number
  problems: string[]
  constructor(message: string, status: number, problems: string[] = []) {
    super(message)
    this.status = status
    this.problems = problems
  }
}

// Keep the API same-origin by default for local/Docker runs. Set
// VITE_API_BASE_URL when the static frontend and FastAPI are hosted separately.
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/+$/, '')
const apiUrl = (path: string) => `${API_BASE_URL}/api${path}`

export const getToken = () => localStorage.getItem('pt_token') || ''
export const setToken = (t: string) => (t ? localStorage.setItem('pt_token', t) : localStorage.removeItem('pt_token'))

export async function api<T = any>(path: string, opts: { method?: string; json?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = {}
  const token = getToken()
  if (token) headers.Authorization = `Bearer ${token}`
  let body: BodyInit | undefined
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(opts.json)
  } else if (opts.form) body = opts.form
  let res: Response
  try {
    res = await fetch(apiUrl(path), { method: opts.method || (body ? 'POST' : 'GET'), headers, body })
  } catch {
    throw new ApiError('Tidak dapat menghubungi layanan API. Periksa koneksi dan konfigurasi aplikasi.', 0)
  }
  if (res.status === 401 && !path.startsWith('/auth/login')) {
    setToken('')
    window.dispatchEvent(new Event('pt-logout'))
  }
  if (!res.ok) {
    let msg = res.statusText
    try {
      const d = await res.json()
      const detail = d.detail ?? d
      if (typeof detail === 'string') msg = detail
      else if (Array.isArray(detail)) msg = detail.map((x: any) => x.msg || JSON.stringify(x)).join('; ')
      else msg = detail.message || JSON.stringify(detail)
    } catch { /* abaikan */ }
    throw new ApiError(msg, res.status)
  }
  return res.json() as Promise<T>
}

export async function downloadFile(path: string, filename?: string): Promise<void> {
  const token = getToken()
  let res: Response
  try {
    res = await fetch(apiUrl(path), { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  } catch {
    throw new ApiError('Tidak dapat menghubungi backend.', 0)
  }
  if (res.status === 401) {
    setToken('')
    window.dispatchEvent(new Event('pt-logout'))
  }
  if (!res.ok) {
    let message = res.statusText
    try {
      const data = await res.json()
      message = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail ?? data)
    } catch { /* abaikan */ }
    throw new ApiError(message, res.status)
  }
  const blob = await res.blob()
  const disposition = res.headers.get('content-disposition') ?? ''
  const serverFilename = disposition.match(/filename\*?=(?:UTF-8''|\")?([^;\"]+)/i)?.[1]?.replace(/\"$/, '')
  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = filename ?? serverFilename ?? 'unduhan'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000)
}
