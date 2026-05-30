import { useEffect, useRef, useState, useCallback } from "react";
import Icon from "@/components/ui/icon";
import Scene3D from "@/components/Scene3D";
import { AIBrain, type Block, type AIPosition, type AIMood } from "@/lib/aiBrain";

interface LogEntry {
  id: number;
  type: "success" | "error" | "info" | "think";
  message: string;
  time: string;
}

interface Stats {
  attempts: number;
  errors: number;
  successes: number;
  generation: number;
  intelligence: number;
  qStates: number;
  successRate: number;
  blockCount: number;
  maxLayer: number;
}

export default function Index() {
  // Brain (persistent across renders)
  const brainRef = useRef<AIBrain>(
    new AIBrain({ learningRate: 0.3, explorationRate: 0.4, platformSize: 4, maxHeight: 20 })
  );

  // Shared refs for the 3D scene (avoid re-render on every tick)
  const posRef = useRef<AIPosition>({ x: 0, y: 0, z: 0 });
  const moodRef = useRef<AIMood>("idle");

  const animRef = useRef<number>(0);
  const tickRef = useRef(0);
  const logIdRef = useRef(0);
  const runningRef = useRef(false);

  const [blocks, setBlocks] = useState<Block[]>([]);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [aiMood, setAiMood] = useState<AIMood>("idle");
  const [activeTab, setActiveTab] = useState<"control" | "log" | "neural">("control");
  const [flashType, setFlashType] = useState<"" | "error" | "success">("");

  const [params, setParams] = useState({
    learningRate: 0.3,
    explorationRate: 0.4,
    platformSize: 4,
    speed: 1,
  });

  const [stats, setStats] = useState<Stats>({
    attempts: 0, errors: 0, successes: 0, generation: 1,
    intelligence: 5, qStates: 0, successRate: 0, blockCount: 0, maxLayer: 0,
  });
  const [qVals, setQVals] = useState<number[]>([0, 0, 0, 0, 0, 0, 0]);

  useEffect(() => { runningRef.current = running; }, [running]);

  // sync params → brain
  useEffect(() => {
    brainRef.current.setParams({
      learningRate: params.learningRate,
      explorationRate: params.explorationRate,
      platformSize: params.platformSize,
    });
  }, [params]);

  const addLog = useCallback((type: LogEntry["type"], message: string) => {
    const now = new Date();
    const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
    setLogs((prev) => [{ id: logIdRef.current++, type, message, time }, ...prev].slice(0, 120));
  }, []);

  const syncStats = useCallback(() => {
    const b = brainRef.current;
    const maxLayer = b.blocks.reduce((m, bl) => Math.max(m, bl.y), 0);
    setStats({
      attempts: b.attempts,
      errors: b.errors,
      successes: b.successes,
      generation: b.generation,
      intelligence: b.intelligence,
      qStates: b.qStates,
      successRate: b.successRate,
      blockCount: b.blocks.length,
      maxLayer: maxLayer + (b.blocks.length ? 1 : 0),
    });
    setQVals([...b.currentQ()]);
  }, []);

  // ── Main loop ──
  useEffect(() => {
    let last = 0;
    const loop = (t: number) => {
      animRef.current = requestAnimationFrame(loop);
      const b = brainRef.current;
      const interval = Math.max(40, 320 / params.speed);
      if (t - last < interval) return;
      last = t;

      if (!runningRef.current) return;
      tickRef.current++;

      const think = b.thinkMessage();
      if (think) addLog("think", think);

      const result = b.step();

      // update shared refs (scene reads these every frame)
      posRef.current = { ...b.pos };
      moodRef.current = result.mood;
      setAiMood(result.mood);

      if (result.type === "place" && result.placedBlock) {
        setBlocks([...b.blocks]);
        addLog("success", result.message);
        setFlashType("success");
        setTimeout(() => setFlashType(""), 350);
      } else if (result.type === "error") {
        addLog("error", result.message);
        setFlashType("error");
        setTimeout(() => setFlashType(""), 350);
      }

      syncStats();
    };
    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [params.speed, addLog, syncStats]);

  const toggleRun = () => {
    const next = !running;
    setRunning(next);
    addLog("info", next ? "▶ Симуляция запущена — ИИ начал строить" : "⏸ Симуляция приостановлена");
  };

  const resetScene = () => {
    brainRef.current.reset();
    posRef.current = { x: 0, y: 0, z: 0 };
    moodRef.current = "idle";
    setBlocks([]);
    setLogs([]);
    setRunning(false);
    setAiMood("idle");
    syncStats();
    addLog("info", "↺ Сцена сброшена. ИИ обучается с нуля.");
  };

  const logColors = { success: "#10b981", error: "#f87171", info: "#06b6d4", think: "#a78bfa" };
  const logIcons = { success: "CheckCircle", error: "AlertCircle", info: "Info", think: "Brain" } as const;
  const layers = [6, 7, 7, 7]; // neural diagram (6 inputs, 7 outputs/actions)
  const actionLabels = ["← ВЛЕВО", "→ ВПРАВО", "↑ ВПЕРЁД", "↓ НАЗАД", "▲ ВВЕРХ", "▼ ВНИЗ", "◆ ПОСТАВИТЬ"];

  return (
    <div
      className={`w-screen h-screen flex overflow-hidden bg-background ${flashType === "error" ? "animate-error-flash" : ""} ${flashType === "success" ? "animate-success-flash" : ""}`}
    >
      <div className="scanline" />

      {/* ── 3D Viewport ── */}
      <div className="flex-1 relative">
        <Scene3D
          blocks={blocks}
          posRef={posRef}
          moodRef={moodRef}
          platformSize={params.platformSize}
        />

        {/* HUD overlays */}
        <div className="absolute top-4 left-4 text-[10px] font-mono pointer-events-none">
          <div className="text-cyan-400/70 tracking-widest">SYS_AI_BUILDER v2.0</div>
          <div className="text-purple-400/40 tracking-wider">VOXEL_NEURAL_ENGINE · THREE.JS</div>
        </div>
        <div className="absolute top-4 right-4 text-[10px] font-mono text-right pointer-events-none">
          <div className="text-cyan-400/50">ЛКМ · ВРАЩЕНИЕ</div>
          <div className="text-slate-600">КОЛЁСИКО · ЗУМ</div>
        </div>
        <div className="absolute bottom-4 left-4 pointer-events-none flex items-center gap-3 text-[10px] font-mono">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-400 inline-block" />ПЛАТФОРМА</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-cyan-400 inline-block" />СЕТКА</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />БЛОКИ</span>
        </div>
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
            <div className="text-[10px] text-purple-400/50 truncate">Воксельный Строитель</div>
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

        {/* Stats */}
        <div className="grid grid-cols-4 border-b border-purple-500/20">
          {[
            { label: "ПОПЫТОК", value: stats.attempts, color: "text-cyan-400" },
            { label: "ОШИБОК", value: stats.errors, color: "text-red-400" },
            { label: "БЛОКОВ", value: stats.blockCount, color: "text-emerald-400" },
            { label: "ТОЧН%", value: stats.successRate + "%", color: "text-purple-400" },
          ].map(({ label, value, color }) => (
            <div key={label} className="px-2 py-2 border-r border-purple-500/10 last:border-0 text-center">
              <div className={`text-sm font-mono font-bold ${color}`}>{value}</div>
              <div className="text-[7px] text-slate-700 leading-tight mt-0.5">{label}</div>
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* ── CONTROL ── */}
          {activeTab === "control" && (
            <div className="p-3 space-y-4">
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

              {/* Intelligence */}
              <div>
                <div className="flex justify-between text-[10px] font-mono mb-1.5">
                  <span className="text-slate-500">ИНТЕЛЛЕКТ ИИ</span>
                  <span className="text-purple-400">{stats.intelligence.toFixed(0)} / 100</span>
                </div>
                <div className="h-2 bg-slate-800/80 rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-500"
                    style={{ width: `${stats.intelligence}%`, background: "linear-gradient(90deg, #7c3aed, #06b6d4)", boxShadow: "0 0 10px rgba(139,92,246,0.5)" }} />
                </div>
              </div>

              {/* Params */}
              {[
                { key: "learningRate", label: "СКОРОСТЬ ОБУЧЕНИЯ", min: 0.01, max: 1, step: 0.01, color: "#a855f7" },
                { key: "explorationRate", label: "ИССЛЕДОВАНИЕ", min: 0.01, max: 1, step: 0.01, color: "#06b6d4" },
                { key: "speed", label: "СКОРОСТЬ СИМУЛЯЦИИ", min: 0.2, max: 8, step: 0.1, color: "#10b981" },
                { key: "platformSize", label: "РАЗМЕР ПЛАТФОРМЫ", min: 2, max: 10, step: 1, color: "#f59e0b" },
              ].map(({ key, label, min, max, step, color }) => (
                <div key={key}>
                  <div className="flex justify-between text-[10px] font-mono mb-1">
                    <span className="text-slate-600">{label}</span>
                    <span style={{ color }} className="font-semibold">{params[key as keyof typeof params]}</span>
                  </div>
                  <input
                    type="range" min={min} max={max} step={step}
                    value={params[key as keyof typeof params]}
                    onChange={(e) => setParams((p) => ({ ...p, [key]: parseFloat(e.target.value) }))}
                    className="w-full h-1 rounded-full appearance-none cursor-pointer"
                    style={{ accentColor: color }}
                  />
                </div>
              ))}

              {/* State box */}
              <div className="relative border border-cyan-500/20 rounded p-3 bg-cyan-500/5">
                <div className="absolute top-0 left-0 w-3 h-3 border-t border-l border-cyan-400/60" />
                <div className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-cyan-400/60" />
                <div className="text-[10px] text-slate-500 font-mono mb-2">СОСТОЯНИЕ МОДЕЛИ</div>
                <div className="space-y-1">
                  {[
                    { l: "Поколение", v: `GEN ${stats.generation}`, c: "text-purple-400" },
                    { l: "Блоков построено", v: stats.blockCount, c: "text-cyan-400" },
                    { l: "Высота башни", v: `${stats.maxLayer} слоёв`, c: "text-emerald-400" },
                    { l: "Q-состояний", v: stats.qStates, c: "text-amber-400" },
                  ].map(({ l, v, c }) => (
                    <div key={l} className="flex justify-between text-[10px] font-mono">
                      <span className="text-slate-600">{l}</span>
                      <span className={`${c} font-semibold`}>{v}</span>
                    </div>
                  ))}
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
                      <span className="text-[10px] font-mono leading-tight" style={{ color: logColors[log.type] + "cc" }}>{log.message}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── NEURAL ── */}
          {activeTab === "neural" && (
            <div className="p-3 space-y-4">
              <div>
                <div className="text-[10px] text-slate-500 font-mono mb-2">АРХИТЕКТУРА СЕТИ</div>
                <svg width="100%" height="120" viewBox="0 0 240 120" className="overflow-visible">
                  {layers.map((nodeCount, li) => {
                    const lx = (li / (layers.length - 1)) * 210 + 15;
                    return Array.from({ length: nodeCount }).map((_, ni) => {
                      const ny = nodeCount === 1 ? 60 : (ni / (nodeCount - 1)) * 100 + 10;
                      const isActive = running && Math.random() > 0.45;
                      const conns = li < layers.length - 1
                        ? Array.from({ length: layers[li + 1] }).map((_, nni) => {
                            const nx2 = ((li + 1) / (layers.length - 1)) * 210 + 15;
                            const ny2 = layers[li + 1] === 1 ? 60 : (nni / (layers[li + 1] - 1)) * 100 + 10;
                            return { nx2, ny2, w: Math.random() };
                          })
                        : [];
                      return (
                        <g key={`${li}-${ni}`}>
                          {conns.map((c, ci) => (
                            <line key={ci} x1={lx} y1={ny} x2={c.nx2} y2={c.ny2}
                              stroke={`rgba(139,92,246,${c.w * 0.22 + 0.03})`} strokeWidth={c.w * 1 + 0.2} />
                          ))}
                          <circle cx={lx} cy={ny} r={isActive ? 5 : 4}
                            fill={isActive ? "#a855f7" : "#160d30"}
                            stroke={isActive ? "#c084fc" : "#4c1d95"} strokeWidth={1.2}
                            style={{ filter: isActive ? "drop-shadow(0 0 4px #a855f7)" : "none" }} />
                        </g>
                      );
                    });
                  })}
                </svg>
                <div className="flex justify-between text-[8px] text-slate-700 font-mono">
                  <span>ВХОД[6]</span><span>СКР[7]</span><span>СКР[7]</span><span>ВЫХ[7]</span>
                </div>
              </div>

              <div>
                <div className="text-[10px] text-slate-500 font-mono mb-2">Q-ОЦЕНКИ ДЕЙСТВИЙ</div>
                {actionLabels.map((action, idx) => {
                  const val = qVals[idx] ?? 0;
                  const maxAbs = Math.max(...qVals.map(Math.abs), 0.01);
                  const pct = Math.abs(val) / maxAbs;
                  const isPos = val >= 0;
                  return (
                    <div key={idx} className="mb-1.5">
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

              <div className="relative border border-purple-500/20 rounded p-3 bg-purple-500/5">
                <div className="absolute top-0 left-0 w-3 h-3 border-t border-l border-purple-400/60" />
                <div className="absolute bottom-0 right-0 w-3 h-3 border-b border-r border-purple-400/60" />
                <div className="text-[10px] text-slate-500 font-mono mb-2">МЕТРИКИ ОБУЧЕНИЯ</div>
                {[
                  { label: "Исследование", value: (params.explorationRate * 100).toFixed(0) + "%", color: "#06b6d4" },
                  { label: "Скорость обучения", value: (params.learningRate * 100).toFixed(0) + "%", color: "#a855f7" },
                  { label: "Точность", value: stats.successRate + "%", color: "#10b981" },
                  { label: "Q-состояний", value: stats.qStates, color: "#f59e0b" },
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
            Q-LEARNING · VOXEL ENGINE ACTIVE
          </div>
        </div>
      </div>
    </div>
  );
}
