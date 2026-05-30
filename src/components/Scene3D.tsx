import { useRef, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Grid, Edges } from "@react-three/drei";
import * as THREE from "three";
import type { Block, AIPosition, AIMood } from "@/lib/aiBrain";

const CELL = 1; // world units per grid cell

const MOOD_COLORS: Record<AIMood, string> = {
  idle: "#c084fc",
  thinking: "#a78bfa",
  building: "#06b6d4",
  error: "#f87171",
  success: "#34d399",
};

// ─── Single voxel block ────────────────────────────────────────────────────
function VoxelBlock({ block }: { block: Block }) {
  return (
    <mesh
      position={[block.x * CELL, block.y * CELL + CELL / 2, block.z * CELL]}
      castShadow
      receiveShadow
    >
      <boxGeometry args={[CELL * 0.92, CELL * 0.92, CELL * 0.92]} />
      <meshStandardMaterial
        color={block.color}
        metalness={0.4}
        roughness={0.25}
        emissive={block.color}
        emissiveIntensity={0.18}
      />
      <Edges color={block.color} scale={1.01} threshold={15} />
    </mesh>
  );
}

// ─── AI Sphere (pulsing, glowing) ──────────────────────────────────────────
function AISphere({ posRef, moodRef }: { posRef: React.MutableRefObject<AIPosition>; moodRef: React.MutableRefObject<AIMood> }) {
  const groupRef = useRef<THREE.Group>(null);
  const coreRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const ring1 = useRef<THREE.Mesh>(null);
  const ring2 = useRef<THREE.Mesh>(null);
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const target = useRef(new THREE.Vector3());
  const color = useRef(new THREE.Color(MOOD_COLORS.idle));

  useFrame((state, delta) => {
    const p = posRef.current;
    target.current.set(p.x * CELL, p.y * CELL + CELL * 1.4, p.z * CELL);
    if (groupRef.current) {
      groupRef.current.position.lerp(target.current, Math.min(1, delta * 8));
    }
    const t = state.clock.elapsedTime;
    const pulse = 1 + Math.sin(t * 3) * 0.08;
    if (coreRef.current) coreRef.current.scale.setScalar(pulse);
    if (glowRef.current) glowRef.current.scale.setScalar(pulse * 1.4);
    if (ring1.current) {
      ring1.current.rotation.x = t * 0.8;
      ring1.current.rotation.y = t * 0.5;
    }
    if (ring2.current) {
      ring2.current.rotation.z = t * 0.6;
      ring2.current.rotation.x = -t * 0.4;
    }
    // mood color transition
    const targetColor = new THREE.Color(MOOD_COLORS[moodRef.current]);
    color.current.lerp(targetColor, Math.min(1, delta * 5));
    if (matRef.current) {
      matRef.current.color.copy(color.current);
      matRef.current.emissive.copy(color.current);
    }
    if (lightRef.current) lightRef.current.color.copy(color.current);
  });

  return (
    <group ref={groupRef}>
      <pointLight ref={lightRef} intensity={3} distance={8} color={MOOD_COLORS.idle} />
      {/* Core sphere */}
      <mesh ref={coreRef}>
        <sphereGeometry args={[0.42, 32, 32]} />
        <meshStandardMaterial
          ref={matRef}
          color={MOOD_COLORS.idle}
          emissive={MOOD_COLORS.idle}
          emissiveIntensity={0.6}
          metalness={0.3}
          roughness={0.15}
        />
      </mesh>
      {/* Glow shell */}
      <mesh ref={glowRef}>
        <sphereGeometry args={[0.42, 24, 24]} />
        <meshBasicMaterial color={MOOD_COLORS.idle} transparent opacity={0.12} />
      </mesh>
      {/* Orbiting rings */}
      <mesh ref={ring1}>
        <torusGeometry args={[0.65, 0.015, 12, 48]} />
        <meshBasicMaterial color="#06b6d4" transparent opacity={0.6} />
      </mesh>
      <mesh ref={ring2}>
        <torusGeometry args={[0.78, 0.012, 12, 48]} />
        <meshBasicMaterial color="#a855f7" transparent opacity={0.5} />
      </mesh>
    </group>
  );
}

// ─── Platform ──────────────────────────────────────────────────────────────
function Platform({ size }: { size: number }) {
  const span = size * 2 + 1;
  return (
    <group>
      {/* Solid platform base */}
      <mesh position={[0, -0.18, 0]} receiveShadow>
        <boxGeometry args={[span, 0.3, span]} />
        <meshStandardMaterial
          color="#1a1530"
          metalness={0.6}
          roughness={0.4}
          emissive="#7c3aed"
          emissiveIntensity={0.08}
        />
        <Edges color="#a855f7" />
      </mesh>
      {/* Build grid on top */}
      <Grid
        position={[0, 0.01, 0]}
        args={[span, span]}
        cellSize={1}
        cellThickness={0.6}
        cellColor="#7c3aed"
        sectionSize={span}
        sectionThickness={1}
        sectionColor="#06b6d4"
        fadeDistance={40}
        fadeStrength={1}
        infiniteGrid={false}
      />
    </group>
  );
}

// ─── Build cursor (ghost cell highlight) ───────────────────────────────────
function BuildCursor({ posRef }: { posRef: React.MutableRefObject<AIPosition> }) {
  const ref = useRef<THREE.Mesh>(null);
  const target = useRef(new THREE.Vector3());
  useFrame((_, delta) => {
    const p = posRef.current;
    target.current.set(p.x * CELL, p.y * CELL + CELL / 2, p.z * CELL);
    if (ref.current) ref.current.position.lerp(target.current, Math.min(1, delta * 10));
  });
  return (
    <mesh ref={ref}>
      <boxGeometry args={[CELL, CELL, CELL]} />
      <meshBasicMaterial color="#06b6d4" transparent opacity={0.08} wireframe />
    </mesh>
  );
}

// ─── Scene contents ────────────────────────────────────────────────────────
function SceneContents({
  blocks,
  posRef,
  moodRef,
  platformSize,
}: {
  blocks: Block[];
  posRef: React.MutableRefObject<AIPosition>;
  moodRef: React.MutableRefObject<AIMood>;
  platformSize: number;
}) {
  const blockKey = useMemo(
    () => blocks.map((b) => `${b.x},${b.y},${b.z}`).join("|"),
    [blocks]
  );

  return (
    <>
      <ambientLight intensity={0.35} />
      <directionalLight
        position={[10, 18, 8]}
        intensity={1.2}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
      />
      <pointLight position={[-10, 8, -10]} intensity={0.5} color="#06b6d4" />
      <pointLight position={[10, 6, 10]} intensity={0.4} color="#a855f7" />

      {/* Infinite reference floor grid */}
      <Grid
        position={[0, -0.35, 0]}
        args={[100, 100]}
        cellSize={2}
        cellThickness={0.4}
        cellColor="#2a1f4a"
        sectionSize={10}
        sectionThickness={0.8}
        sectionColor="#3b2d6b"
        fadeDistance={60}
        fadeStrength={1.5}
        infiniteGrid
      />

      <Platform size={platformSize} />
      <BuildCursor posRef={posRef} />

      <group key={blockKey}>
        {blocks.map((b, i) => (
          <VoxelBlock key={`${b.x},${b.y},${b.z}-${i}`} block={b} />
        ))}
      </group>

      <AISphere posRef={posRef} moodRef={moodRef} />

      <OrbitControls
        enablePan={false}
        minDistance={6}
        maxDistance={40}
        maxPolarAngle={Math.PI / 2.05}
        dampingFactor={0.08}
        enableDamping
      />
    </>
  );
}

// ─── Exported Scene ─────────────────────────────────────────────────────────
export default function Scene3D({
  blocks,
  posRef,
  moodRef,
  platformSize,
}: {
  blocks: Block[];
  posRef: React.MutableRefObject<AIPosition>;
  moodRef: React.MutableRefObject<AIMood>;
  platformSize: number;
}) {
  return (
    <Canvas
      shadows
      camera={{ position: [10, 9, 12], fov: 50 }}
      gl={{ antialias: true, alpha: false }}
      style={{ background: "transparent" }}
    >
      <color attach="background" args={["#070a12"]} />
      <fog attach="fog" args={["#070a12", 25, 60]} />
      <SceneContents
        blocks={blocks}
        posRef={posRef}
        moodRef={moodRef}
        platformSize={platformSize}
      />
    </Canvas>
  );
}
