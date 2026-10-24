import { useCallback, useRef, useState } from 'react'
import { api, ApiError } from './api'

export interface JobState {
  id?: string
  status: 'idle' | 'queued' | 'running' | 'done' | 'error'
  stages: { key: string; label: string; status: string; seconds: number | null }[]
  progress: number
  run_id?: string | null
  error?: string | null
  problems?: string[]
  process_seconds?: number | null
  total_seconds?: number | null
}
const IDLE: JobState = { status: 'idle', stages: [], progress: 0 }

/** Mulai job audit dan polling progres NYATA dari backend. */
export function useJob(onDone?: (runId: string) => void) {
  const [job, setJob] = useState<JobState>(IDLE)
  const timer = useRef<number>()

  const poll = useCallback((id: string) => {
    const tick = async () => {
      try {
        const j = await api<JobState>(`/audit/jobs/${id}`)
        setJob(j)
        if (j.status === 'done') { if (j.run_id) onDone?.(j.run_id); return }
        if (j.status === 'error') return
      } catch (e) {
        setJob((p) => ({ ...p, status: 'error', error: (e as Error).message }))
        return
      }
      timer.current = window.setTimeout(tick, 300)
    }
    tick()
  }, [onDone])

  const start = useCallback(async (path: string, opts: { json?: unknown; form?: FormData }) => {
    window.clearTimeout(timer.current)
    setJob({ ...IDLE, status: 'queued' })
    try {
      const r = await api<{ job_id: string }>(path, opts)
      poll(r.job_id)
    } catch (e) {
      setJob({ ...IDLE, status: 'error', error: (e as ApiError).message })
    }
  }, [poll])

  return { job, start, reset: () => setJob(IDLE) }
}
