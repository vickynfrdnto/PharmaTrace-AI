import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ContactShadows, Environment, Grid, Html, Lightformer, PerformanceMonitor, RoundedBox } from '@react-three/drei'
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

export type NodeId = 'p1' | 'p2' | 'p3' | 'ok' | 'review'
type V3 = [number, number, number]

const DOORS: { id: NodeId; name: string; short: string; sub: string; color: string; pos: V3 }[] = [
  { id: 'p1', name: 'Pintu 1 · Procurement', short: 'Procurement', sub: 'Faktur e-Katalog / ERP (CSV)', color: '#4C9AFF', pos: [-4.4, 2.1, 0] },
  { id: 'p2', name: 'Pintu 2 · RME', short: 'RME', sub: 'Resep dan pemberian obat (FHIR-like JSON)', color: '#2DD4A7', pos: [-4.4, 0, 0] },
  { id: 'p3', name: 'Pintu 3 · Klaim VEDIKA', short: 'Klaim VEDIKA', sub: 'Klaim obat dan alkes (CSV)', color: '#FFB020', pos: [-4.4, -2.1, 0] },
]
const OK_POS: V3 = [4.4, 1.7, 0]
const REVIEW_POS: V3 = [4.4, -1.7, 0]
const FLOOR = -3.1
const OK_COLOR = '#34D39E'
const RISK_COLOR = '#FF6B5E'
const RED = new THREE.Color(RISK_COLOR)
const GREEN = new THREE.Color('#A7E05A')

const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z)
const IN_CURVES = DOORS.map((d) => new THREE.CubicBezierCurve3(v(d.pos[0] + 0.8, d.pos[1]), v(-2.3, d.pos[1]), v(-2.3, 0), v(-1.05, 0)))
const OUT_OK = new THREE.CubicBezierCurve3(v(1.05, 0), v(2.5, 0), v(2.5, OK_POS[1]), v(OK_POS[0] - 0.85, OK_POS[1]))
const OUT_REVIEW = new THREE.CubicBezierCurve3(v(1.05, 0), v(2.5, 0), v(2.5, REVIEW_POS[1]), v(REVIEW_POS[0] - 0.9, REVIEW_POS[1]))

export interface SceneProps {
  counts?: { p?: number; r?: number; c?: number }
  flagged?: number
  total?: number
  anomRate: number
  running: boolean
  progress: number
  /** naik setiap kali audit selesai → gelombang kejut dari inti */
  burst?: number
  onFps?: (fps: number) => void
  onSelect?: (id: NodeId) => void
  /** tinggi layar kecil: kurangi partikel dan efek */
  compact?: boolean
}

/* ---------- Partikel data ---------- */
function Particles({ anomRate, running, onFps, n, lite }: Pick<SceneProps, 'anomRate' | 'running' | 'onFps'> & { n: number; lite: boolean }) {
  const mesh = useRef<THREE.InstancedMesh>(null!)
  const halo = useRef<THREE.InstancedMesh>(null!)
  const dummy = useMemo(() => new THREE.Object3D(), [])
  const tmp = useMemo(() => new THREE.Vector3(), [])
  const st = useMemo(() => ({
    t: Float32Array.from({ length: n }, () => Math.random()),
    speed: Float32Array.from({ length: n }, () => 0.12 + Math.random() * 0.18),
    phase: new Uint8Array(n),
    lane: Uint8Array.from({ length: n }, () => Math.floor(Math.random() * 3)),
    out: new Uint8Array(n),
    sway: Float32Array.from({ length: n }, () => (Math.random() - 0.5) * 0.45),
  }), [n])
  const anom = useRef(anomRate); anom.current = anomRate
  const run = useRef(running); run.current = running
  const fps = useRef({ n: 0, t: 0 })
  const laneColors = useMemo(() => DOORS.map((d) => new THREE.Color(d.color)), [])
  const setCol = (i: number, c: THREE.Color) => { mesh.current.setColorAt(i, c); halo.current.setColorAt(i, c) }

  useLayoutEffect(() => {
    for (let i = 0; i < n; i++) setCol(i, laneColors[st.lane[i]])
    mesh.current.instanceColor!.needsUpdate = true
    halo.current.instanceColor!.needsUpdate = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [laneColors, st, n])

  useFrame((_, dt) => {
    const d = Math.min(dt, 0.05)
    const rate = run.current ? 2.8 : 1
    let colorDirty = false
    for (let i = 0; i < n; i++) {
      st.t[i] += st.speed[i] * d * rate
      if (st.t[i] >= 1) {
        st.t[i] = 0
        if (st.phase[i] === 0) {
          st.phase[i] = 1
          st.out[i] = Math.random() < anom.current ? 1 : 0
          setCol(i, st.out[i] ? RED : GREEN)
        } else {
          st.phase[i] = 0
          st.lane[i] = Math.floor(Math.random() * 3)
          setCol(i, laneColors[st.lane[i]])
        }
        colorDirty = true
      }
      const t = st.t[i]
      const curve = st.phase[i] === 0 ? IN_CURVES[st.lane[i]] : st.out[i] ? OUT_REVIEW : OUT_OK
      curve.getPoint(t, tmp)
      const arc = Math.sin(Math.PI * t) * st.sway[i]
      dummy.position.set(tmp.x, tmp.y + arc * 0.5, tmp.z + arc)
      const s = st.phase[i] === 1 && st.out[i] ? 0.1 : 0.064
      dummy.scale.setScalar(s)
      dummy.updateMatrix()
      mesh.current.setMatrixAt(i, dummy.matrix)
      dummy.scale.setScalar(s * 3.6)
      dummy.updateMatrix()
      halo.current.setMatrixAt(i, dummy.matrix)
    }
    mesh.current.instanceMatrix.needsUpdate = true
    halo.current.instanceMatrix.needsUpdate = true
    if (colorDirty) { mesh.current.instanceColor!.needsUpdate = true; halo.current.instanceColor!.needsUpdate = true }
    fps.current.n++; fps.current.t += dt
    if (fps.current.t >= 1) { onFps?.(Math.round(fps.current.n / fps.current.t)); fps.current = { n: 0, t: 0 } }
  })
  return (
    <>
      <instancedMesh ref={mesh} args={[undefined, undefined, n]} frustumCulled={false}>
        <sphereGeometry args={[1, lite ? 6 : 10, lite ? 6 : 10]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={halo} args={[undefined, undefined, n]} frustumCulled={false} renderOrder={2}>
        <sphereGeometry args={[1, 8, 8]} />
        <meshBasicMaterial toneMapped={false} transparent opacity={0.16} depthWrite={false} blending={THREE.AdditiveBlending} />
      </instancedMesh>
    </>
  )
}

/* ---------- Debu cahaya di latar: memberi kedalaman ---------- */
function Dust({ n }: { n: number }) {
  const ref = useRef<THREE.Points>(null!)
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const a = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) { a[i * 3] = (Math.random() - 0.5) * 22; a[i * 3 + 1] = (Math.random() - 0.5) * 9; a[i * 3 + 2] = -2 - Math.random() * 7 }
    g.setAttribute('position', new THREE.BufferAttribute(a, 3))
    return g
  }, [n])
  useFrame((_, dt) => { ref.current.rotation.y += dt * 0.012; ref.current.position.y = Math.sin(performance.now() / 4000) * 0.15 })
  return <points ref={ref} geometry={geo}><pointsMaterial size={0.035} color="#8FE9CD" transparent opacity={0.45} sizeAttenuation depthWrite={false} blending={THREE.AdditiveBlending} /></points>
}

/* ---------- Pipa kaca dengan inti cahaya ---------- */
function Pipe({ curve, color }: { curve: THREE.Curve<THREE.Vector3>; color: string }) {
  const outer = useMemo(() => new THREE.TubeGeometry(curve, 64, 0.075, 12, false), [curve])
  const inner = useMemo(() => new THREE.TubeGeometry(curve, 64, 0.022, 8, false), [curve])
  return (
    <group>
      <mesh geometry={outer} renderOrder={1}>
        <meshPhysicalMaterial color={color} transparent opacity={0.22} roughness={0.08} clearcoat={1} clearcoatRoughness={0.05} envMapIntensity={2} depthWrite={false} />
      </mesh>
      <mesh geometry={inner}><meshBasicMaterial color={color} toneMapped={false} transparent opacity={0.85} /></mesh>
    </group>
  )
}

/* ---------- Inti engine ---------- */
function Core({ running, progress, burst = 0 }: { running: boolean; progress: number; burst: number }) {
  const g = useRef<THREE.Group>(null!)
  const rings = useRef<THREE.Group>(null!)
  const inner = useRef<THREE.Mesh>(null!)
  const light = useRef<THREE.PointLight>(null!)
  const wave = useRef<THREE.Mesh>(null!)
  const waveT = useRef(2)
  useEffect(() => { if (burst > 0) waveT.current = 0 }, [burst])
  useFrame(({ clock }, dt) => {
    g.current.rotation.y += dt * (running ? 1.4 : 0.3)
    g.current.rotation.x += dt * 0.12
    rings.current.rotation.z += dt * (running ? 1.1 : 0.25)
    rings.current.rotation.y += dt * 0.15
    const pulse = running ? 0.5 + 0.5 * Math.sin(clock.elapsedTime * 6) * (0.4 + progress) : 0.4
    inner.current.scale.setScalar(1 + (running ? 0.08 * pulse : 0))
    light.current.intensity = running ? 26 + 18 * pulse : 14
    if (waveT.current < 1.6) {
      waveT.current += dt
      const p = waveT.current / 1.6
      wave.current.visible = true
      wave.current.scale.setScalar(1 + p * 7)
      ;(wave.current.material as THREE.MeshBasicMaterial).opacity = (1 - p) * 0.9
    } else wave.current.visible = false
  })
  return (
    <group>
      <pointLight ref={light} color="#A7E05A" distance={9} />
      <group ref={g}>
        <mesh><icosahedronGeometry args={[0.8, 1]} /><meshBasicMaterial color="#A7E05A" wireframe transparent opacity={0.55} toneMapped={false} /></mesh>
        <mesh ref={inner}>
          <sphereGeometry args={[0.46, 32, 32]} />
          <meshStandardMaterial color="#1E9970" emissive="#6FE3A0" emissiveIntensity={running ? 2.4 : 1.2} roughness={0.35} />
        </mesh>
      </group>
      <mesh renderOrder={1}>
        <sphereGeometry args={[0.98, 48, 48]} />
        <meshPhysicalMaterial color="#d6fff0" transparent opacity={0.14} roughness={0} clearcoat={1} envMapIntensity={3} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <group ref={rings}>
        <mesh rotation={[Math.PI / 2.4, 0, 0]}><torusGeometry args={[1.28, 0.012, 8, 120]} /><meshBasicMaterial color="#A7E05A" toneMapped={false} transparent opacity={0.85} /></mesh>
        <mesh rotation={[Math.PI / 2.4, 0.9, 0.6]}><torusGeometry args={[1.5, 0.008, 8, 120]} /><meshBasicMaterial color="#6FD3B0" toneMapped={false} transparent opacity={0.5} /></mesh>
        <mesh rotation={[Math.PI / 1.7, -0.7, 0]}><torusGeometry args={[1.7, 0.006, 8, 120]} /><meshBasicMaterial color="#A7E05A" toneMapped={false} transparent opacity={0.3} /></mesh>
      </group>
      {/* busur progres audit */}
      {running && progress > 0 && (
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <ringGeometry args={[2.0, 2.06, 96, 1, 0, Math.max(0.05, progress * Math.PI * 2)]} />
          <meshBasicMaterial color="#A7E05A" toneMapped={false} side={THREE.DoubleSide} />
        </mesh>
      )}
      <mesh ref={wave} visible={false}>
        <ringGeometry args={[0.95, 1.0, 96]} />
        <meshBasicMaterial color="#A7E05A" transparent toneMapped={false} depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

function Projector({ color, w, y = 0 }: { color: string; w: number; y?: number }) {
  const h = y - FLOOR
  return (
    <group>
      <mesh position={[0, y - h / 2, 0]}>
        <cylinderGeometry args={[w * 0.32, w * 0.46, h, 28, 1, true]} />
        <meshBasicMaterial color={color} transparent opacity={0.05} depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, FLOOR + 0.02, 0]}>
        <ringGeometry args={[w * 0.5, w * 0.56, 64]} />
        <meshBasicMaterial color={color} transparent opacity={0.7} toneMapped={false} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[0, FLOOR + 0.015, 0]}>
        <circleGeometry args={[w * 0.5, 48]} />
        <meshBasicMaterial color={color} transparent opacity={0.12} toneMapped={false} depthWrite={false} blending={THREE.AdditiveBlending} />
      </mesh>
    </group>
  )
}

/* ---------- Node: slab kaca + panel berwarna; klik untuk membuka halaman terkait ---------- */
function Node({ id, pos, color, title, short, sub, detail, w = 1.5, onSelect, below = true }: { id: NodeId; pos: V3; color: string; title: string; short: string; sub: string; detail: string; w?: number; onSelect?: (id: NodeId) => void; below?: boolean }) {
  const [hover, setHover] = useState(false)
  const g = useRef<THREE.Group>(null!)
  const hv = useRef(false)
  const phase = pos[0] * 1.3 + pos[1]
  useFrame(({ clock }, dt) => {
    g.current.position.y = Math.sin(clock.elapsedTime * 0.9 + phase) * 0.05
    const target = hv.current ? 1.07 : 1
    g.current.scale.x = THREE.MathUtils.damp(g.current.scale.x, target, 8, dt)
    g.current.scale.y = g.current.scale.z = g.current.scale.x
  })
  const over = (e: { stopPropagation: () => void }) => { e.stopPropagation(); hv.current = true; setHover(true); document.body.style.cursor = 'pointer' }
  const out = () => { hv.current = false; setHover(false); document.body.style.cursor = 'auto' }
  return (
    <group position={pos}>
      <Projector color={color} w={w} />
      <group ref={g} onPointerOver={over} onPointerOut={out} onClick={(e) => { e.stopPropagation(); onSelect?.(id) }}>
        <RoundedBox args={[w, 0.9, 0.5]} radius={0.12} smoothness={4}>
          <meshPhysicalMaterial color="#0c1824" metalness={0.65} roughness={0.22} clearcoat={1} clearcoatRoughness={0.1} envMapIntensity={1.6} />
        </RoundedBox>
        <RoundedBox args={[w - 0.14, 0.76, 0.03]} radius={0.06} smoothness={3} position={[0, 0, 0.255]}>
          <meshPhysicalMaterial color={color} emissive={color} emissiveIntensity={hover ? 1.1 : 0.45} transparent opacity={0.74} roughness={0.12} clearcoat={1} envMapIntensity={2} />
        </RoundedBox>
        <mesh position={[0, 0.43, 0.02]}><boxGeometry args={[w * 0.82, 0.03, 0.46]} /><meshBasicMaterial color={color} toneMapped={false} /></mesh>
        <mesh position={[0, -0.43, 0.02]}><boxGeometry args={[w * 0.82, 0.03, 0.46]} /><meshBasicMaterial color={color} toneMapped={false} /></mesh>
        <mesh position={[-w / 2 + 0.17, 0, 0.28]}><sphereGeometry args={[0.04, 12, 12]} /><meshBasicMaterial color="#ffffff" toneMapped={false} /></mesh>
      </group>
      <Html center position={[0, below ? -0.9 : 0.9, 0]} zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
        <div className="select-none whitespace-nowrap rounded-md bg-stage/70 px-1.5 py-0.5 text-center leading-tight backdrop-blur-[2px]">
          <div className="text-[11px] font-bold text-white [text-shadow:0_1px_6px_rgba(0,0,0,.8)]">{short}</div>
          <div className="text-[10px] font-medium text-white/60 [text-shadow:0_1px_6px_rgba(0,0,0,.8)]">{detail}</div>
        </div>
      </Html>
      {hover && (
        <Html position={[0, 1.05, 0]} center zIndexRange={[20, 10]} style={{ pointerEvents: 'none' }}>
          <div className="w-52 rounded-xl border border-white/15 bg-stage/95 p-2.5 text-[11px] shadow-pop backdrop-blur">
            <div className="font-bold text-white">{title}</div><div className="mt-0.5 text-white/65">{sub}</div><div className="mt-1.5 font-semibold" style={{ color }}>Klik untuk membuka</div>
          </div>
        </Html>
      )}
    </group>
  )
}

/* ---------- Kamera: terbang masuk saat muncul, paralaks halus mengikuti kursor, menyesuaikan lebar layar ---------- */
function Rig({ fine }: { fine: boolean }) {
  const t = useRef(0)
  const { camera } = useThree()
  useFrame(({ pointer, size }, dt) => {
    t.current = Math.min(1, t.current + dt / 2.2)
    const e = 1 - Math.pow(1 - t.current, 4)
    const aspect = size.width / size.height
    const z = Math.max(8.6, (aspect < 1.5 ? 18.5 : 14.8) / aspect)
    const px = fine ? pointer.x * 1.5 : Math.sin(performance.now() / 4200) * 0.6
    const py = 1.3 + (fine ? pointer.y * 0.55 : 0)
    const tx = THREE.MathUtils.lerp(-7, px, e)
    const ty = THREE.MathUtils.lerp(4.2, py, e)
    const tz = THREE.MathUtils.lerp(z + 8, z, e)
    camera.position.x = THREE.MathUtils.damp(camera.position.x, tx, 4, dt)
    camera.position.y = THREE.MathUtils.damp(camera.position.y, ty, 4, dt)
    camera.position.z = THREE.MathUtils.damp(camera.position.z, tz, 4, dt)
    camera.lookAt(0, -0.2, 0)
  })
  return null
}

function World(p: SceneProps & { fine: boolean; lite: boolean; n: number }) {
  const g = useRef<THREE.Group>(null!)
  useFrame(({ clock }) => { g.current.position.y = Math.sin(clock.elapsedTime * 0.6) * 0.05 })
  const fmt = (x?: number) => (x === undefined ? 'menunggu audit' : `${x.toLocaleString('id-ID')} record`)
  const flagged = p.flagged ?? 0
  const total = p.total ?? 0
  return (
    <>
      <color attach="background" args={['#061315']} />
      <fog attach="fog" args={['#061315', 16, 34]} />
      <Environment resolution={256} frames={1}>
        <Lightformer form="rect" intensity={3.2} position={[0, 6, -4]} scale={[14, 3, 1]} color="#dff3ff" />
        <Lightformer form="rect" intensity={2.2} position={[-8, 1, 3]} rotation-y={Math.PI / 2} scale={[8, 3, 1]} color="#4C9AFF" />
        <Lightformer form="rect" intensity={2.2} position={[8, 1, 3]} rotation-y={-Math.PI / 2} scale={[8, 3, 1]} color="#A7E05A" />
        <Lightformer form="ring" intensity={1.5} position={[0, -1, 8]} scale={4} color="#ffffff" />
      </Environment>
      <ambientLight intensity={0.25} />
      <directionalLight position={[4, 7, 6]} intensity={1.4} color="#e8f6ff" />

      <Grid position={[0, FLOOR - 0.01, 0]} args={[40, 40]} cellSize={0.6} cellThickness={0.6} cellColor="#16363a" sectionSize={3} sectionThickness={1} sectionColor="#1f5a52" fadeDistance={24} fadeStrength={1.6} infiniteGrid />
      {!p.lite && <ContactShadows position={[0, FLOOR, 0]} opacity={0.5} scale={20} blur={2.6} far={7} resolution={512} color="#000000" />}
      <Dust n={p.lite ? 60 : 140} />
      <group position={[0, 0, 0]}><Projector color="#A7E05A" w={2.6} /></group>

      <group ref={g}>
        {IN_CURVES.map((c, i) => <Pipe key={DOORS[i].id} curve={c} color={DOORS[i].color} />)}
        <Pipe curve={OUT_OK} color={OK_COLOR} />
        <Pipe curve={OUT_REVIEW} color={RISK_COLOR} />
        {DOORS.map((d, i) => (
          <Node key={d.id} id={d.id} pos={d.pos} color={d.color} title={d.name} short={p.compact ? d.short : `Pintu ${i + 1} · ${d.short}`} sub={d.sub} detail={fmt([p.counts?.p, p.counts?.r, p.counts?.c][i])} onSelect={p.onSelect} />
        ))}
        <Core running={p.running} progress={p.progress} burst={p.burst ?? 0} />
        <Node id="ok" pos={OK_POS} color={OK_COLOR} title="Sesuai" short="Sesuai" sub="Selaras di 3 pintu, jalur verifikasi lancar" detail={total ? `${(total - flagged).toLocaleString('id-ID')} klaim` : 'menunggu audit'} w={1.6} onSelect={p.onSelect} />
        <Node id="review" pos={REVIEW_POS} color={RISK_COLOR} title="Jalur Verifikator" short="Verifikator" sub="Ada selisih: Discrepancy Index + alasan (SHAP). Keputusan di manusia." detail={total ? `${flagged.toLocaleString('id-ID')} ter-flag` : 'menunggu audit'} w={1.7} onSelect={p.onSelect} />
        <Particles anomRate={p.anomRate} running={p.running} onFps={p.onFps} n={p.n} lite={p.lite} />
      </group>
      <Rig fine={p.fine} />
      {!p.lite && (
        <EffectComposer multisampling={0}>
          <Bloom intensity={0.5} luminanceThreshold={0.68} luminanceSmoothing={0.2} mipmapBlur />
          <Vignette eskil={false} offset={0.2} darkness={0.7} />
        </EffectComposer>
      )}
    </>
  )
}

export default function Scene3D(props: SceneProps) {
  const wrap = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(true)
  const [lite, setLite] = useState(!!props.compact)
  const fine = useMemo(() => typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches, [])
  const n = lite ? 220 : props.compact ? 260 : 460

  // jeda render saat di luar layar → hemat baterai & CPU
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.02 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div ref={wrap} className="absolute inset-0 touch-pan-y">
      <Canvas
        dpr={lite ? 1 : [1, 1.75]}
        frameloop={visible ? 'always' : 'never'}
        camera={{ position: [-7, 4.2, 25], fov: 42 }}
        gl={{ antialias: !lite, powerPreference: 'high-performance' }}
        style={{ touchAction: 'pan-y' }}
      >
        <PerformanceMonitor onDecline={() => setLite(true)} flipflops={2} bounds={() => [24, 90]}>
          <World {...props} fine={fine} lite={lite} n={n} />
        </PerformanceMonitor>
      </Canvas>
    </div>
  )
}
