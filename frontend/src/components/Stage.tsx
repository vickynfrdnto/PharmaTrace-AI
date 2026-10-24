import { lazy, Suspense, useMemo, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import FlowDiagram2D from './FlowDiagram2D'
import { useApp } from '../lib/app'
import { useMedia } from '../lib/hooks'
import type { NodeId, SceneProps } from './Scene3D'

const Scene3D = lazy(() => import('./Scene3D'))

const webgl = () => {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')) } catch { return false }
}

const ROUTES: Record<NodeId, string> = { p1: '/audit', p2: '/audit', p3: '/audit', ok: '/inspector?status=Selaras', review: '/inspector' }

/** Panggung gelap untuk visual 3D (selalu gelap, di kedua tema). */
export default function Stage({ className = '', children, ...scene }: Omit<SceneProps, 'compact' | 'onSelect'> & { className?: string; children?: ReactNode }) {
  const { reduced } = useApp()
  const nav = useNavigate()
  const small = useMedia('(max-width: 767px)')
  const ok = useMemo(webgl, [])
  const use3d = !reduced && ok
  return (
    <div className={`relative overflow-hidden rounded-3xl bg-stage shadow-pop ring-1 ring-white/10 ${className}`}>
      <div className="grain pointer-events-none absolute inset-0 opacity-40" aria-hidden />
      {use3d ? (
        <Suspense fallback={<div className="absolute inset-0 grid place-items-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-white/15 border-t-lime" role="status" aria-label="Memuat visual 3D" /></div>}>
          <Scene3D {...scene} compact={small} onSelect={(id) => nav(ROUTES[id])} />
        </Suspense>
      ) : (
        <div className="absolute inset-0 grid place-items-center p-4"><FlowDiagram2D flagged={scene.flagged} total={scene.total} /></div>
      )}
      {children}
    </div>
  )
}
