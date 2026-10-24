import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { canRun, useApp } from './lib/app'

const Audit = lazy(() => import('./pages/Audit'))
const Evaluation = lazy(() => import('./pages/Evaluation'))
const Heatmap = lazy(() => import('./pages/Heatmap'))
const HomePage = lazy(() => import('./pages/Home'))
const Impact = lazy(() => import('./pages/Impact'))
const Inspector = lazy(() => import('./pages/Inspector'))
const Login = lazy(() => import('./pages/Login'))
const Privacy = lazy(() => import('./pages/Privacy'))
const RandomAudit = lazy(() => import('./pages/RandomAudit'))
const Validation = lazy(() => import('./pages/Validation'))

function LoadingPage() {
  return <div className="grid min-h-dvh place-items-center bg-canvas"><div className="h-9 w-9 animate-spin rounded-full border-2 border-line border-t-brand" role="status" aria-label="Memuat halaman" /></div>
}

export default function App() {
  const { user, booting } = useApp()
  const canViewGlobal = canRun(user)
  if (booting) return <div className="grid min-h-dvh place-items-center bg-canvas"><div className="h-9 w-9 animate-spin rounded-full border-2 border-line border-t-brand" role="status" aria-label="Memuat" /></div>
  if (!user) return <Suspense fallback={<LoadingPage />}><Login /></Suspense>
  return (
    <Suspense fallback={<LoadingPage />}>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<HomePage />} />
          <Route path="audit" element={<Audit />} />
          <Route path="heatmap" element={<Heatmap />} />
          <Route path="inspector" element={<Inspector />} />
          <Route path="evaluasi" element={canViewGlobal ? <Evaluation /> : <Navigate to="/" replace />} />
          <Route path="audit-acak" element={<RandomAudit />} />
          <Route path="dampak" element={canViewGlobal ? <Impact /> : <Navigate to="/" replace />} />
          <Route path="validasi" element={canViewGlobal ? <Validation /> : <Navigate to="/" replace />} />
          <Route path="privasi" element={<Privacy />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
