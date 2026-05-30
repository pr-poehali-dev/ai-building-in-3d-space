import { useEffect, useRef, useState, useCallback } from "react";
import Icon from "@/components/ui/icon";

// ─── Types ───────────────────────────────────────────────────────────────────
interface Block {
  x: number;
  y: number;
  z: number;
  color: string;
  placed: boolean;
}

interface LogEntry {
  id: number;
  type: "success" | "error" | "info" | "think";
  message: string;
  time: string;
}

interface AIState {
  x: number;
  y: number;
  z: number;
  mood: "idle" | "thinking" | "building" | "error" | "success";
}

interface Stats {
  attempts: number;
  errors: number;
  successes: number;
  generation: number;
  intelligence: number;
}

interface AIParams {
  learningRate: number;
  explorationRate: number;
  platformSize: number;
  speed: number;
  maxBlocks: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────
const PLATFORM_Y = 0;
const BLOCK_SIZE = 0.8;

const THINK_MESSAGES = [
  "Анализирую пространство...",
  "Вычисляю оптимальную позицию...",
  "Проверяю границы платформы...",
  "Оцениваю структурную устойчивость...",
  "Применяю опыт предыдущих попыток...",
  "Рассчитываю траекторию...",
  "Обновляю нейронную матрицу...",
];
const ERROR_MESSAGES = [
  "ОШИБКА: Позиция вне платформы",
  "ОШИБКА: Выход за границу зоны строительства",
  "ОШИБКА: Нестабильное размещение блока",
];
const SUCCESS_MESSAGES = [
  "УСПЕХ: Блок размещён корректно",
  "УСПЕХ: Структура стабильна",
  "УСПЕХ: Позиция в допустимых границах",
];

// ─── 3D Projection ────────────────────────────────────────────────────────────
function project3D(
  x: number, y: number, z: number,
  W: number, H: number, rotY: number, rotX: number
) {
  const cosY = Math.cos(rotY), sinY = Math.sin(rotY);
  const cosX = Math.cos(rotX), sinX = Math.sin(rotX);
  const rx = x * cosY - z * sinY;
  const rz = x * sinY + z * cosY;
  const ry2 = y * cosX - rz * sinX;
  const rz2 = y * sinX + rz * cosX;
  const fov = 400;
  const zOff = rz2 + 8;
  const scale = fov / (fov + zOff);
  return {
    sx: W / 2 + rx * scale * 40,
    sy: H / 2 - ry2 * scale * 40,
    scale,
    depth: zOff,
  };
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function Index() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const rotRef = useRef({ y: 0.5, x: 0.3 });
  const dragRef = useRef({ dragging: false, lastX: 0, lastY: 0 });
  const blocksRef = useRef<Block[]>([]);
  const aiRef = useRef<AIState>({ x: 0, y: 2, z: 0, mood: "idle" });
  const thinkTimerRef = useRef(0);
  const logIdRef = useRef(0);
  const qTableRef = useRef<Record<string, number[]>>({});
  const lastStateRef = useRef("");
  const lastActionRef = useRef(0);

  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [stats, setStats] = useState<Stats>({
    attempts: 0, errors: 0, successes: 0, generation: 1, intelligence: 5,
  });
  const [params, setParams] = useState<AIParams>({
    learningRate: 0.3, explorationRate: 0.4,
    platformSize: 4, speed: 1, maxBlocks: 10,
  });
  const [activeTab, setActiveTab] = useState<"control" | "log" | "neural">("control");
  const [aiMood, setAiMood] = useState<AIState["mood"]>("idle");
  const [flashType, setFlashType] = useState<"" | "error" | "success">("");

  const paramsRef = useRef(params);
  const runningRef = useRef(running);
  const statsRef = useRef(stats);

  useEffect(() => { paramsRef.current = params; }, [params]);
  useEffect(() => { runningRef.current = running; }, [running]);
  useEffect(() => { statsRef.current = stats; }, [stats]);

  const addLog = useCallback((type: LogEntry["type"], message: string) => {
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
    setLogs((prev) => [{ id: logIdRef.current++, type, message, time }, ...prev].slice(0, 100));
  }, []);

  // ─── Q-Learning helpers ──────────────────────────────────────────────────
  const getState = useCallback((ai: AIState) => {
    const pSize = paramsRef.current.platformSize;
    const sx = Math.round(ai.x), sz = Math.round(ai.z);
    const inBounds = Math.abs(sx) <= pSize && Math.abs(sz) <= pSize ? 1 : 0;
    const blockCount = Math.min(blocksRef.current.length, 5);
    return `${sx},${sz},${inBounds},${blockCount}`;
  }, []);

  const getQValues = useCallback((state: string) => {
    if (!qTableRef.current[state]) qTableRef.current[state] = [0, 0, 0, 0, 0];
    return qTableRef.current[state];
  }, []);

  const chooseAction = useCallback((state: string) => {
    const p = paramsRef.current;
    if (Math.random() < p.explorationRate) return Math.floor(Math.random() * 5);
    const q = getQValues(state);
    return q.indexOf(Math.max(...q));
  }, [getQValues]);

  const updateQ = useCallback((state: string, action: number, reward: number, nextState: string) => {
    const p = paramsRef.current;
    const q = getQValues(state);
    const nextQ = getQValues(nextState);
    const maxNextQ = Math.max(...nextQ);
    q[action] = q[action] + p.learningRate * (reward + 0.9 * maxNextQ - q[action]);
  }, [getQValues]);

  // ─── AI Step ─────────────────────────────────────────────────────────────
  const aiStep = useCallback(() => {
    const ai = aiRef.current;
    const p = paramsRef.current;
    const pSize = p.platformSize;

    thinkTimerRef.current++;
    if (thinkTimerRef.current < Math.max(2, Math.round(40 / p.speed))) return;
    thinkTimerRef.current = 0;

    if (Math.random() < 0.07) {
      addLog("think", THINK_MESSAGES[Math.floor(Math.random() * THINK_MESSAGES.length)]);
    }

    const state = getState(ai);
    const action = chooseAction(state);
    lastStateRef.current = state;
    lastActionRef.current = action;

    const step = 1;
    let nx = ai.x, nz = ai.z;
    let shouldPlace = false;

    if (action === 0) nx -= step;
    else if (action === 1) nx += step;
    else if (action === 2) nz -= step;
    else if (action === 3) nz += step;
    else shouldPlace = true;

    nx = Math.max(-pSize - 1, Math.min(pSize + 1, nx));
    nz = Math.max(-pSize - 1, Math.min(pSize + 1, nz));

    aiRef.current = { ...ai, x: nx, z: nz, y: 2 };

    const inBounds = Math.abs(nx) <= pSize && Math.abs(nz) <= pSize;

    if (shouldPlace) {
      setStats((prev) => {
        const ns = { ...prev, attempts: prev.attempts + 1 };

        if (inBounds && prev.attempts < p.maxBlocks * 3) {
          const alreadyOccupied = blocksRef.current.some(
            (b) => Math.abs(b.x - nx) < 0.5 && Math.abs(b.z - nz) < 0.5
          );
          if (!alreadyOccupied && blocksRef.current.length < p.maxBlocks) {
            const colors = ["#a855f7", "#06b6d4", "#10b981", "#f59e0b", "#ec4899", "#3b82f6"];
            blocksRef.current = [
              ...blocksRef.current,
              {
                x: nx, y: PLATFORM_Y + 0.4, z: nz,
                color: colors[Math.floor(Math.random() * colors.length)],
                placed: true,
              },
            ];
            addLog("success", SUCCESS_MESSAGES[Math.floor(Math.random() * SUCCESS_MESSAGES.length)] + ` [${nx.toFixed(0)}, ${nz.toFixed(0)}]`);
            setAiMood("success");
            setFlashType("success");
            setTimeout(() => setFlashType(""), 400);
            const nextState = getState(aiRef.current);
            updateQ(lastStateRef.current, lastActionRef.current, 10, nextState);
            const intel = Math.min(100, prev.intelligence + 1.5);
            const newSuccesses = prev.successes + 1;
            const newGen = newSuccesses > 0 && newSuccesses % 5 === 0 ? prev.generation + 1 : prev.generation;
            if (newGen > prev.generation) {
              addLog("info", `◆ ЭВОЛЮЦИЯ: поколение ${newGen} — ИИ стал умнее`);
              setParams((pp) => ({ ...pp, explorationRate: Math.max(0.05, pp.explorationRate * 0.9) }));
            }
            return { ...ns, successes: newSuccesses, generation: newGen, intelligence: intel };
          }
        }

        addLog("error", ERROR_MESSAGES[Math.floor(Math.random() * ERROR_MESSAGES.length)] + ` [${nx.toFixed(0)}, ${nz.toFixed(0)}]`);
        setAiMood("error");
        setFlashType("error");
        setTimeout(() => setFlashType(""), 400);
        const nextState = getState(aiRef.current);
        updateQ(lastStateRef.current, lastActionRef.current, -5, nextState);
        return { ...ns, errors: prev.errors + 1 };
      });
    } else {
      const reward = inBounds ? 1 : -2;
      const nextState = getState(aiRef.current);
      updateQ(lastStateRef.current, lastActionRef.current, reward, nextState);
      setAiMood(inBounds ? "thinking" : "error");
    }
  }, [addLog, getState, chooseAction, updateQ]);

  // ─── Draw ─────────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    const rot = rotRef.current;
    const ai = aiRef.current;
    const pSize = paramsRef.current.platformSize;

    ctx.clearRect(0, 0, W, H);

    // Background
    const bg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.8);
    bg.addColorStop(0, "#0a0d16");
    bg.addColorStop(1, "#05070c");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const proj = (x: number, y: number, z: number) =>
      project3D(x, y, z, W, H, rot.y, rot.x);

    // ── World grid ──
    ctx.lineWidth = 0.5;
    for (let i = -14; i <= 14; i++) {
      const alpha = i % 4 === 0 ? 0.12 : 0.05;
      ctx.strokeStyle = `rgba(139, 92, 246, ${alpha})`;
      const a = proj(i, -1, -14), b = proj(i, -1, 14);
      const c = proj(-14, -1, i), d = proj(14, -1, i);
      ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(c.sx, c.sy); ctx.lineTo(d.sx, d.sy); ctx.stroke();
    }

    // ── Axes ──
    const axisLen = 6;
    const origin = proj(0, -1, 0);
    const axes = [
      { end: proj(axisLen, -1, 0), color: "#f87171", label: "X" },
      { end: proj(0, axisLen - 1, 0), color: "#34d399", label: "Y" },
      { end: proj(0, -1, axisLen), color: "#60a5fa", label: "Z" },
    ];
    ctx.lineWidth = 1.5;
    axes.forEach(({ end, color, label }) => {
      ctx.strokeStyle = color + "99";
      ctx.beginPath(); ctx.moveTo(origin.sx, origin.sy); ctx.lineTo(end.sx, end.sy); ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = "bold 11px IBM Plex Mono";
      ctx.fillText(label, end.sx + 4, end.sy - 4);
    });

    // ── Platform ──
    const ps = pSize;
    const corners = [
      proj(-ps, PLATFORM_Y, -ps), proj(ps, PLATFORM_Y, -ps),
      proj(ps, PLATFORM_Y, ps), proj(-ps, PLATFORM_Y, ps),
    ];
    const btm = [
      proj(-ps, PLATFORM_Y - 0.35, -ps), proj(ps, PLATFORM_Y - 0.35, -ps),
      proj(ps, PLATFORM_Y - 0.35, ps), proj(-ps, PLATFORM_Y - 0.35, ps),
    ];

    // Top face
    ctx.beginPath();
    ctx.moveTo(corners[0].sx, corners[0].sy);
    corners.forEach((c) => ctx.lineTo(c.sx, c.sy));
    ctx.closePath();
    const platFill = ctx.createLinearGradient(corners[0].sx, corners[0].sy, corners[2].sx, corners[2].sy);
    platFill.addColorStop(0, "rgba(139, 92, 246, 0.14)");
    platFill.addColorStop(1, "rgba(6, 182, 212, 0.08)");
    ctx.fillStyle = platFill;
    ctx.fill();
    ctx.strokeStyle = "rgba(139, 92, 246, 0.7)";
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Side faces
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      ctx.beginPath();
      ctx.moveTo(corners[i].sx, corners[i].sy);
      ctx.lineTo(corners[j].sx, corners[j].sy);
      ctx.lineTo(btm[j].sx, btm[j].sy);
      ctx.lineTo(btm[i].sx, btm[i].sy);
      ctx.closePath();
      ctx.fillStyle = "rgba(139, 92, 246, 0.05)";
      ctx.fill();
      ctx.strokeStyle = "rgba(139, 92, 246, 0.25)";
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }

    // Platform grid
    for (let i = -ps; i <= ps; i++) {
      ctx.strokeStyle = "rgba(139, 92, 246, 0.18)";
      ctx.lineWidth = 0.5;
      const a = proj(i, PLATFORM_Y, -ps), b = proj(i, PLATFORM_Y, ps);
      const c = proj(-ps, PLATFORM_Y, i), d = proj(ps, PLATFORM_Y, i);
      ctx.beginPath(); ctx.moveTo(a.sx, a.sy); ctx.lineTo(b.sx, b.sy); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(c.sx, c.sy); ctx.lineTo(d.sx, d.sy); ctx.stroke();
    }

    // Platform label
    const platLabel = proj(0, PLATFORM_Y - 0.6, pSize + 1.8);
    ctx.fillStyle = "rgba(139, 92, 246, 0.55)";
    ctx.font = "10px IBM Plex Mono";
    ctx.textAlign = "center";
    ctx.fillText(`PLATFORM [${pSize * 2}×${pSize * 2}]`, platLabel.sx, platLabel.sy);
    ctx.textAlign = "left";

    // ── Blocks ──
    const sortedBlocks = [...blocksRef.current].sort((a, b) => {
      const da = proj(a.x, a.y, a.z).depth;
      const db = proj(b.x, b.y, b.z).depth;
      return db - da;
    });

    sortedBlocks.forEach((block) => {
      const bs = BLOCK_SIZE / 2;
      const top = [
        proj(block.x - bs, block.y + bs, block.z - bs),
        proj(block.x + bs, block.y + bs, block.z - bs),
        proj(block.x + bs, block.y + bs, block.z + bs),
        proj(block.x - bs, block.y + bs, block.z + bs),
      ];
      const front = [
        proj(block.x - bs, block.y - bs, block.z - bs),
        proj(block.x + bs, block.y - bs, block.z - bs),
        proj(block.x + bs, block.y + bs, block.z - bs),
        proj(block.x - bs, block.y + bs, block.z - bs),
      ];
      const right = [
        proj(block.x + bs, block.y - bs, block.z - bs),
        proj(block.x + bs, block.y - bs, block.z + bs),
        proj(block.x + bs, block.y + bs, block.z + bs),
        proj(block.x + bs, block.y + bs, block.z - bs),
      ];

      const drawFace = (face: typeof top, bright: number) => {
        ctx.beginPath();
        ctx.moveTo(face[0].sx, face[0].sy);
        face.forEach((p) => ctx.lineTo(p.sx, p.sy));
        ctx.closePath();
        const r = parseInt(block.color.slice(1, 3), 16);
        const g = parseInt(block.color.slice(3, 5), 16);
        const b2 = parseInt(block.color.slice(5, 7), 16);
        ctx.fillStyle = `rgba(${Math.round(r * bright)},${Math.round(g * bright)},${Math.round(b2 * bright)},0.88)`;
        ctx.fill();
        ctx.strokeStyle = block.color + "88";
        ctx.lineWidth = 0.8;
        ctx.stroke();
      };
      drawFace(top, 1.0);
      drawFace(front, 0.65);
      drawFace(right, 0.45);

      // Block glow
      const center = proj(block.x, block.y, block.z);
      const grd = ctx.createRadialGradient(center.sx, center.sy, 0, center.sx, center.sy, 22 * center.scale);
      grd.addColorStop(0, block.color + "33");
      grd.addColorStop(1, "transparent");
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(center.sx, center.sy, 22 * center.scale, 0, Math.PI * 2);
      ctx.fill();
    });

    // ── AI Sphere ──
    const aiPos = proj(ai.x, ai.y, ai.z);
    const r = Math.max(10, 18 * aiPos.scale);
    const t = Date.now() / 1000;
    const pulse = 1 + Math.sin(t * 2.5) * 0.1;

    // Outer aura rings
    for (let ring = 3; ring >= 1; ring--) {
      const auraGrd = ctx.createRadialGradient(aiPos.sx, aiPos.sy, 0, aiPos.sx, aiPos.sy, r * ring * pulse);
      auraGrd.addColorStop(0, "rgba(168, 85, 247, 0)");
      auraGrd.addColorStop(0.5, `rgba(168, 85, 247, ${0.05 / ring})`);
      auraGrd.addColorStop(1, "transparent");
      ctx.fillStyle = auraGrd;
      ctx.beginPath();
      ctx.arc(aiPos.sx, aiPos.sy, r * ring * pulse, 0, Math.PI * 2);
      ctx.fill();
    }

    // Sphere body
    const sphereGrd = ctx.createRadialGradient(
      aiPos.sx - r * 0.3, aiPos.sy - r * 0.3, r * 0.05,
      aiPos.sx, aiPos.sy, r * pulse
    );
    const moodColors: Record<AIState["mood"], [string, string]> = {
      idle: ["#c084fc", "#7c3aed"],
      thinking: ["#a78bfa", "#5b21b6"],
      building: ["#06b6d4", "#0284c7"],
      error: ["#f87171", "#dc2626"],
      success: ["#34d399", "#059669"],
    };
    const mc = moodColors[ai.mood];
    sphereGrd.addColorStop(0, mc[0]);
    sphereGrd.addColorStop(1, mc[1]);
    ctx.fillStyle = sphereGrd;
    ctx.beginPath();
    ctx.arc(aiPos.sx, aiPos.sy, r * pulse, 0, Math.PI * 2);
    ctx.fill();

    // Sphere highlight
    const hlGrd = ctx.createRadialGradient(aiPos.sx - r * 0.4, aiPos.sy - r * 0.4, 0, aiPos.sx, aiPos.sy, r);
    hlGrd.addColorStop(0, "rgba(255,255,255,0.35)");
    hlGrd.addColorStop(1, "transparent");
    ctx.fillStyle = hlGrd;
    ctx.beginPath();
    ctx.arc(aiPos.sx, aiPos.sy, r * pulse, 0, Math.PI * 2);
    ctx.fill();

    // AI shadow
    const shadowPos = proj(ai.x, PLATFORM_Y, ai.z);
    const shGrd = ctx.createRadialGradient(shadowPos.sx, shadowPos.sy, 0, shadowPos.sx, shadowPos.sy, 25);
    shGrd.addColorStop(0, "rgba(168, 85, 247, 0.22)");
    shGrd.addColorStop(1, "transparent");
    ctx.fillStyle = shGrd;
    ctx.beginPath();
    ctx.ellipse(shadowPos.sx, shadowPos.sy, 28, 11, 0, 0, Math.PI * 2);
    ctx.fill();

    // AI labels
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "bold 10px IBM Plex Mono";
    ctx.fillText("AI", aiPos.sx, aiPos.sy + r + 14);
    ctx.fillStyle = "rgba(168, 85, 247, 0.7)";
    ctx.font = "9px IBM Plex Mono";
    ctx.fillText(`(${ai.x.toFixed(0)}, ${ai.z.toFixed(0)})`, aiPos.sx, aiPos.sy + r + 25);
    ctx.textAlign = "left";

    // Coord ticks
    ctx.fillStyle = "rgba(100, 116, 139, 0.55)";
    ctx.font = "9px IBM Plex Mono";
    for (let i = -4; i <= 4; i++) {
      if (i === 0) continue;
      const p = proj(i, PLATFORM_Y, 0);
      ctx.fillText(String(i), p.sx - 4, p.sy);
    }

    // HUD
    ctx.fillStyle = "rgba(6, 182, 212, 0.45)";
    ctx.font = "10px IBM Plex Mono";
    ctx.fillText(`GEN ${statsRef.current.generation}`, 14, 22);
    ctx.fillText(`IQ ${statsRef.current.intelligence.toFixed(0)}`, 14, 36);
    ctx.fillText(`БЛОКОВ ${blocksRef.current.length}/${paramsRef.current.maxBlocks}`, 14, 50);
  }, []);

  // ─── Animation Loop ───────────────────────────────────────────────────────
  useEffect(() => {
    let lastTime = 0;
    const loop = (t: number) => {
      animRef.current = requestAnimationFrame(loop);
      if (t - lastTime < 16) return;
      lastTime = t;
      if (runningRef.current) aiStep();
      draw();
    };
    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [draw, aiStep]);

  // ─── Canvas resize ────────────────────────────────────────────────────────
  useEffect(() => {
    const resize = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const parent = canvas.parentElement;
      if (!parent) return;
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  // ─── Mouse drag ───────────────────────────────────────────────────────────
  const onMouseDown = (e: React.MouseEvent) => {
    dragRef.current = { dragging: true, lastX: e.clientX, lastY: e.clientY };
  };
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragRef.current.dragging) return;
    rotRef.current.y += (e.clientX - dragRef.current.lastX) * 0.01;
    rotRef.current.x += (e.clientY - dragRef.current.lastY) * 0.01;
    rotRef.current.x = Math.max(-1.2, Math.min(1.2, rotRef.current.x));
    dragRef.current.lastX = e.clientX;
    dragRef.current.lastY = e.clientY;
  };
  const onMouseUp = () => { dragRef.current.dragging = false; };

  // ─── Controls ────────────────────────────────────────────────────────────
  const toggleRun = () => {
    const next = !running;
    setRunning(next);
    addLog("info", next ? "▶ Симуляция запущена" : "⏸ Симуляция приостановлена");
  };

  const resetScene = () => {
    blocksRef.current = [];
    aiRef.current = { x: 0, y: 2, z: 0, mood: "idle" };
    qTableRef.current = {};
    setStats({ attempts: 0, errors: 0, successes: 0, generation: 1, intelligence: 5 });
    setLogs([]);
    setRunning(false);
    setAiMood("idle");
    addLog("info", "↺ Сцена сброшена. ИИ начинает обучение заново.");
  };

  // Derived
  const successRate = stats.attempts > 0 ? Math.round((stats.successes / stats.attempts) * 100) : 0;
  const logColors = { success: "#10b981", error: "#f87171", info: "#06b6d4", think: "#a78bfa" };
  const logIcons = { success: "CheckCircle", error: "AlertCircle", info: "Info", think: "Brain" } as const;
  const layers = [3, 5, 5, 3];

  const getQVals = () => {
    const currentState = getState(aiRef.current);
    return qTableRef.current[currentState] ?? [0, 0, 0, 0, 0];
  };

  return (
    <div
      className={`w-screen h-screen flex overflow-hidden bg-background ${flashType === "error" ? "animate-error-flash" : ""} ${flashType === "success" ? "animate-success-flash" : ""}`}
      style={{ backgroundImage: "linear-gradient(rgba(139,92,246,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(139,92,246,0.04) 1px, transparent 1px)", backgroundSize: "40px 40px" }}
    >
      {/* Scan line */}
      <div className="scanline" />

      {/* ── 3D Canvas ── */}
      <div
        className="flex-1 relative select-none"
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        style={{ cursor: "grab" }}
      >
        <canvas ref={canvasRef} className="w-full h-full" />

        {/* HUD overlays */}
        <div className="absolute top-4 left-4 text-[10px] font-mono pointer-events-none">
          <div className="text-cyan-400/70 tracking-widest">SYS_AI_BUILDER v1.0</div>
          <div className="text-purple-400/40 tracking-wider">NEURAL_3D_ENVIRONMENT</div>
        </div>
        <div className="absolute top-4 right-4 text-[10px] font-mono text-right pointer-events-none">
          <div className="text-cyan-400/50">DRAG TO ROTATE</div>
          <div className="text-slate-600">3D CANVAS ACTIVE</div>
        </div>
        <div className="absolute bottom-4 left-4 pointer-events-none flex items-center gap-3 text-[10px] font-mono">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-400 inline-block" />ПЛАТФОРМА</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" />ВНЕ ГРАНИЦ</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />БЛОК</span>
        </div>

        {/* Mood indicator */}
        <div className="absolute bottom-4 right-4 flex items-center gap-2 pointer-events-none">
          <div className={`w-2.5 h-2.5 rounded-full ${aiMood === "success" ? "bg-emerald-400" : aiMood === "error" ? "bg-red-400" : "bg-purple-400"}`}
            style={{ boxShadow: "0 0 8px currentColor" }} />
          <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">{aiMood}</span>
        </div>
      </div>

      {/* ── Right Panel ── */}
      <div className="w-[280px] flex flex-col border-l border-purple-500/20 bg-[#070a11]/96 flex-shrink-0">

        {/* Header */}
        <div className="px-4 py-3 border-b border-purple-500/20 flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-purple-500 to-purple-900 animate-pulse-glow flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-xs font-mono text-white font-semibold tracking-widest">AI BUILDER</div>
            <div className="text-[10px] text-purple-400/50 truncate">Нейронный Строитель</div>
          </div>
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${running ? "bg-emerald-400 animate-pulse" : "bg-slate-700"}`} />
            <span className="text-[9px] font-mono text-slate-500">{running ? "RUN" : "IDLE"}</span>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-purple-500/20">
          {(["control", "log", "neural"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 text-[9px] font-mono tracking-widest transition-all ${activeTab === tab ? "text-cyan-400 border-b border-cyan-400 bg-cyan-400/5" : "text-slate-600 hover:text-slate-400"}`}
            >
              {tab === "control" ? "УПРАВЛЕНИЕ" : tab === "log" ? "ЖУРНАЛ" : "НЕЙРОСЕТЬ"}
            </button>
          ))}
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-4 border-b border-purple-500/20">
          {[
            { label: "ПОПЫТОК", value: stats.attempts, color: "text-cyan-400" },
            { label: "ОШИБОК", value: stats.errors, color: "text-red-400" },
            { label: "УСПЕХОВ", value: stats.successes, color: "text-emerald-400" },
            { label: "ТОЧН%", value: successRate + "%", color: "text-purple-400" },
          ].map(({ label, value, color }) => (
            <div key={label} className="px-2 py-2 border-r border-purple-500/10 last:border-0 text-center">
              <div className={`text-sm font-mono font-bold ${color}`}>{value}</div>
              <div className="text-[7px] text-slate-700 leading-tight mt-0.5">{label}</div>
            </div>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto">

          {/* ── CONTROL ── */}
          {activeTab === "control" && (
            <div className="p-3 space-y-4">
              {/* Buttons */}
              <div className="flex gap-2">
                <button
                  onClick={toggleRun}
                  className={`flex-1 py-2 text-xs font-mono font-semibold tracking-wider rounded flex items-center justify-center gap-1.5 transition-all border ${running ? "bg-orange-500/15 text-orange-300 border-orange-500/40 hover:bg-orange-500/25" : "bg-emerald-500/15 text-emerald-300 border-emerald-500/40 hover:bg-emerald-500/25"}`}
                >
                  <Icon name={running ? "Pause" : "Play"} size={11} />
                  {running ? "ПАУЗА" : "СТАРТ"}
                </button>
                <button
                  onClick={resetScene}
                  className="px-3 py-2 text-[11px] font-mono text-slate-500 border border-slate-700/50 rounded hover:bg-slate-700/30 hover:text-slate-300 transition-all flex items-center gap-1"
                >
                  <Icon name="RotateCcw" size={11} />
                  СБРОС
                </button>
              </div>

              {/* Intelligence bar */}
              <div>
                <div className="flex justify-between text-[10px] font-mono mb-1.5">
                  <span className="text-slate-500">ИНТЕЛЛЕКТ ИИ</span>
                  <span className="text-purple-400">{stats.intelligence.toFixed(0)} / 100</span>
                </div>
                <div className="h-2 bg-slate-800/80 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${stats.intelligence}%`,
                      background: "linear-gradient(90deg, #7c3aed, #06b6d4)",
                      boxShadow: "0 0 10px rgba(139,92,246,0.5)",
                    }}
                  />
                </div>
              </div>

              {/* Parameters */}
              {[
                { key: "learningRate", label: "СКОРОСТЬ ОБУЧЕНИЯ", min: 0.01, max: 1, step: 0.01, color: "#a855f7" },
                { key: "explorationRate", label: "ИССЛЕДОВАНИЕ", min: 0.01, max: 1, step: 0.01, color: "#06b6d4" },
                { key: "speed", label: "СКОРОСТЬ СИМУЛЯЦИИ", min: 0.1, max: 5, step: 0.1, color: "#10b981" },
                { key: "platformSize", label: "РАЗМЕР ПЛАТФОРМЫ", min: 2, max: 8, step: 1, color: "#f59e0b" },
                { key: "maxBlocks", label: "МАКС. БЛОКОВ", min: 1, max: 30, step: 1, color: "#ec4899" },
              ].map(({ key, label, min, max, step, color }) => (
                <div key={key}>
                  <div className="flex justify-between text-[10px] font-mono mb-1">
                    <span className="text-slate-600">{label}</span>
                    <span style={{ color }} className="font-semibold">{params[key as keyof AIParams]}</span>
                  </div>
                  <input
                    type="range" min={min} max={max} step={step}
                    value={params[key as keyof AIParams]}
                    onChange={(e) => setParams((p) => ({ ...p, [key]: parseFloat(e.target.value) }))}
                    className="w-full h-1 rounded-full appearance-none cursor-pointer"
                    style={{ accentColor: color }}
                  />
                </div>
              ))}

              {/* Info box */}
              <div className="relative border border-cyan-500/20 rounded p-3 bg-cyan-500/5">
                <div className="absolute top-0 left-0 w-3 h-3 border-t border-l border-cyan-400/60" />
                <div className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-cyan-400/60" />
                <div className="text-[10px] text-slate-500 font-mono mb-2">СОСТОЯНИЕ МОДЕЛИ</div>
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] font-mono">
                    <span className="text-slate-600">Поколение</span>
                    <span className="text-purple-400 font-bold">GEN {stats.generation}</span>
                  </div>
                  <div className="flex justify-between text-[10px] font-mono">
                    <span className="text-slate-600">Блоков на сцене</span>
                    <span className="text-cyan-400">{blocksRef.current.length} / {params.maxBlocks}</span>
                  </div>
                  <div className="flex justify-between text-[10px] font-mono">
                    <span className="text-slate-600">Q-состояний</span>
                    <span className="text-emerald-400">{Object.keys(qTableRef.current).length}</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── LOG ── */}
          {activeTab === "log" && (
            <div className="p-2">
              {logs.length === 0 ? (
                <div className="text-center text-slate-700 text-[11px] font-mono py-10">
                  Журнал пуст.<br />Запустите симуляцию.
                </div>
              ) : (
                <div className="space-y-0.5">
                  {logs.map((log) => (
                    <div key={log.id} className="log-entry flex items-start gap-1.5 py-1 px-1.5 rounded hover:bg-white/[0.02]">
                      <span className="text-[9px] text-slate-700 font-mono mt-0.5 flex-shrink-0 w-14">{log.time}</span>
                      <Icon name={logIcons[log.type]} size={9} className="flex-shrink-0 mt-0.5" style={{ color: logColors[log.type] }} />
                      <span className="text-[10px] font-mono leading-tight" style={{ color: logColors[log.type] + "cc" }}>
                        {log.message}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── NEURAL ── */}
          {activeTab === "neural" && (
            <div className="p-3 space-y-4">
              {/* Network diagram */}
              <div>
                <div className="text-[10px] text-slate-500 font-mono mb-2">АРХИТЕКТУРА СЕТИ</div>
                <svg width="100%" height="110" viewBox="0 0 240 110" className="overflow-visible">
                  {layers.map((nodeCount, li) => {
                    const lx = (li / (layers.length - 1)) * 210 + 15;
                    return Array.from({ length: nodeCount }).map((_, ni) => {
                      const ny = nodeCount === 1 ? 55 : (ni / (nodeCount - 1)) * 90 + 10;
                      const isActive = running && Math.random() > 0.4;
                      const conns = li < layers.length - 1
                        ? Array.from({ length: layers[li + 1] }).map((_, nni) => {
                            const nx2 = ((li + 1) / (layers.length - 1)) * 210 + 15;
                            const ny2 = layers[li + 1] === 1 ? 55 : (nni / (layers[li + 1] - 1)) * 90 + 10;
                            return { nx2, ny2, w: Math.random() };
                          })
                        : [];
                      return (
                        <g key={`${li}-${ni}`}>
                          {conns.map((c, ci) => (
                            <line key={ci} x1={lx} y1={ny} x2={c.nx2} y2={c.ny2}
                              stroke={`rgba(139,92,246,${c.w * 0.25 + 0.04})`}
                              strokeWidth={c.w * 1.2 + 0.3}
                            />
                          ))}
                          <circle cx={lx} cy={ny} r={isActive ? 6 : 5}
                            fill={isActive ? "#a855f7" : "#160d30"}
                            stroke={isActive ? "#c084fc" : "#4c1d95"}
                            strokeWidth={1.5}
                            style={{ filter: isActive ? "drop-shadow(0 0 5px #a855f7)" : "none" }}
                          />
                        </g>
                      );
                    });
                  })}
                </svg>
                <div className="flex justify-between text-[8px] text-slate-700 font-mono">
                  <span>ВХОД[3]</span><span>СКР[5]</span><span>СКР[5]</span><span>ВЫХ[3]</span>
                </div>
              </div>

              {/* Q-Values */}
              <div>
                <div className="text-[10px] text-slate-500 font-mono mb-2">Q-ОЦЕНКИ ДЕЙСТВИЙ</div>
                {["← ВЛЕВО", "→ ВПРАВО", "↑ ВПЕРЁД", "↓ НАЗАД", "◆ ПОСТАВИТЬ"].map((action, idx) => {
                  const q = getQVals();
                  const val = q[idx] ?? 0;
                  const maxAbs = Math.max(...q.map(Math.abs), 0.01);
                  const pct = Math.abs(val) / maxAbs;
                  const isPos = val >= 0;
                  return (
                    <div key={idx} className="mb-2">
                      <div className="flex justify-between text-[9px] font-mono mb-0.5">
                        <span className="text-slate-600">{action}</span>
                        <span className={isPos ? "text-emerald-400" : "text-red-400"}>{val.toFixed(2)}</span>
                      </div>
                      <div className="h-1 bg-slate-800 rounded overflow-hidden">
                        <div className="h-full rounded transition-all duration-200"
                          style={{ width: `${pct * 100}%`, background: isPos ? "#10b981" : "#f87171" }} />
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Learning metrics */}
              <div className="relative border border-purple-500/20 rounded p-3 bg-purple-500/5">
                <div className="absolute top-0 left-0 w-3 h-3 border-t border-l border-purple-400/60" />
                <div className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-purple-400/60" />
                <div className="text-[10px] text-slate-500 font-mono mb-2">МЕТРИКИ ОБУЧЕНИЯ</div>
                {[
                  { label: "Исследование", value: (params.explorationRate * 100).toFixed(0) + "%", color: "#06b6d4" },
                  { label: "Скорость обучения", value: (params.learningRate * 100).toFixed(0) + "%", color: "#a855f7" },
                  { label: "Точность", value: successRate + "%", color: "#10b981" },
                  { label: "Q-состояний", value: Object.keys(qTableRef.current).length, color: "#f59e0b" },
                ].map(({ label, value, color }) => (
                  <div key={label} className="flex justify-between text-[10px] font-mono mb-1">
                    <span className="text-slate-600">{label}</span>
                    <span style={{ color }}>{value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-3 py-2 border-t border-purple-500/20">
          <div className="text-[9px] text-slate-700 font-mono flex items-center gap-1.5">
            <span className="animate-blink text-purple-500">█</span>
            Q-LEARNING ENGINE ACTIVE
          </div>
        </div>
      </div>
    </div>
  );
}