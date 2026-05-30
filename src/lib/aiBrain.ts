// ─── AI Brain: Q-Learning engine with voxel grid + vertical building ──────────

export interface Block {
  x: number; // grid coord (integer)
  y: number; // grid coord (integer, vertical layer, 0 = bottom)
  z: number; // grid coord (integer)
  color: string;
}

export interface AIPosition {
  x: number;
  y: number; // hover height
  z: number;
}

export type AIMood = "idle" | "thinking" | "building" | "error" | "success";

export interface StepResult {
  type: "move" | "place" | "error";
  message: string;
  mood: AIMood;
  reward: number;
  placedBlock?: Block;
}

export interface BrainParams {
  learningRate: number;
  explorationRate: number;
  platformSize: number; // half-size: grid spans -platformSize..platformSize
  maxHeight: number;
}

const COLORS = ["#a855f7", "#06b6d4", "#10b981", "#f59e0b", "#ec4899", "#3b82f6", "#ef4444"];

const THINK_MESSAGES = [
  "Анализирую пространство...",
  "Вычисляю оптимальную позицию...",
  "Проверяю границы платформы...",
  "Оцениваю устойчивость конструкции...",
  "Применяю опыт прошлых попыток...",
  "Планирую следующий слой...",
  "Обновляю нейронную матрицу...",
];

// Actions: 0=left(-x) 1=right(+x) 2=forward(-z) 3=back(+z) 4=up(+y) 5=down(-y) 6=place
const NUM_ACTIONS = 7;

export class AIBrain {
  blocks: Block[] = [];
  occupied = new Set<string>(); // "x,y,z"
  pos: AIPosition = { x: 0, y: 0, z: 0 };
  cursor = { x: 0, y: 0, z: 0 }; // current grid cell the AI is targeting
  qTable: Record<string, number[]> = {};
  params: BrainParams;

  attempts = 0;
  errors = 0;
  successes = 0;
  generation = 1;
  intelligence = 5;
  lastThink = "";

  constructor(params: BrainParams) {
    this.params = params;
  }

  setParams(p: Partial<BrainParams>) {
    this.params = { ...this.params, ...p };
  }

  reset() {
    this.blocks = [];
    this.occupied.clear();
    this.cursor = { x: 0, y: 0, z: 0 };
    this.pos = { x: 0, y: 0, z: 0 };
    this.qTable = {};
    this.attempts = 0;
    this.errors = 0;
    this.successes = 0;
    this.generation = 1;
    this.intelligence = 5;
  }

  private key(x: number, y: number, z: number) {
    return `${x},${y},${z}`;
  }

  private inBounds(x: number, z: number) {
    const s = this.params.platformSize;
    return x >= -s && x <= s && z >= -s && z <= s;
  }

  // State signature for Q-learning
  private getState(): string {
    const { x, y, z } = this.cursor;
    const ib = this.inBounds(x, z) ? 1 : 0;
    const occ = this.occupied.has(this.key(x, y, z)) ? 1 : 0;
    // support: is there a block below (or floor)?
    const supported = y === 0 || this.occupied.has(this.key(x, y - 1, z)) ? 1 : 0;
    return `${x},${y},${z},${ib},${occ},${supported}`;
  }

  private getQ(state: string): number[] {
    if (!this.qTable[state]) this.qTable[state] = new Array(NUM_ACTIONS).fill(0);
    return this.qTable[state];
  }

  private chooseAction(state: string): number {
    if (Math.random() < this.params.explorationRate) {
      return Math.floor(Math.random() * NUM_ACTIONS);
    }
    const q = this.getQ(state);
    let best = 0;
    for (let i = 1; i < q.length; i++) if (q[i] > q[best]) best = i;
    return best;
  }

  private updateQ(state: string, action: number, reward: number, nextState: string) {
    const q = this.getQ(state);
    const nq = this.getQ(nextState);
    const maxNext = Math.max(...nq);
    q[action] += this.params.learningRate * (reward + 0.9 * maxNext - q[action]);
  }

  // Q-values for the current cursor state (for visualization)
  currentQ(): number[] {
    return this.getQ(this.getState());
  }

  thinkMessage(): string | null {
    if (Math.random() < 0.07) {
      this.lastThink = THINK_MESSAGES[Math.floor(Math.random() * THINK_MESSAGES.length)];
      return this.lastThink;
    }
    return null;
  }

  step(): StepResult {
    const s = this.params.platformSize;
    const state = this.getState();
    const action = this.chooseAction(state);

    let { x, y, z } = this.cursor;
    let shouldPlace = false;

    switch (action) {
      case 0: x -= 1; break;
      case 1: x += 1; break;
      case 2: z -= 1; break;
      case 3: z += 1; break;
      case 4: y += 1; break;
      case 5: y -= 1; break;
      case 6: shouldPlace = true; break;
    }

    // clamp cursor to allowed exploration range (allow 1 cell beyond for "error" learning)
    x = Math.max(-s - 1, Math.min(s + 1, x));
    y = Math.max(0, Math.min(this.params.maxHeight, y));
    z = Math.max(-s - 1, Math.min(s + 1, z));

    this.cursor = { x, y, z };
    this.pos = { x, y, z };

    if (!shouldPlace) {
      const ib = this.inBounds(x, z);
      const reward = ib ? 0.5 : -2;
      this.updateQ(state, action, reward, this.getState());
      return {
        type: "move",
        message: "",
        mood: ib ? "thinking" : "error",
        reward,
      };
    }

    // ── PLACE attempt ──
    this.attempts++;
    const cellKey = this.key(x, y, z);
    const ib = this.inBounds(x, z);
    const occupied = this.occupied.has(cellKey);
    const supported = y === 0 || this.occupied.has(this.key(x, y - 1, z));

    // Error cases
    if (!ib) {
      this.errors++;
      const reward = -8;
      this.updateQ(state, action, reward, this.getState());
      this.tightenExploration();
      return {
        type: "error",
        message: `ОШИБКА: вне платформы [${x}, ${y}, ${z}]`,
        mood: "error",
        reward,
      };
    }
    if (occupied) {
      this.errors++;
      const reward = -6;
      this.updateQ(state, action, reward, this.getState());
      this.tightenExploration();
      return {
        type: "error",
        message: `ОШИБКА: блок уже существует [${x}, ${y}, ${z}]`,
        mood: "error",
        reward,
      };
    }
    if (!supported) {
      this.errors++;
      const reward = -7;
      this.updateQ(state, action, reward, this.getState());
      this.tightenExploration();
      return {
        type: "error",
        message: `ОШИБКА: нет опоры снизу [${x}, ${y}, ${z}]`,
        mood: "error",
        reward,
      };
    }

    // ── SUCCESS ──
    const block: Block = {
      x, y, z,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
    };
    this.blocks.push(block);
    this.occupied.add(cellKey);
    this.successes++;
    this.intelligence = Math.min(100, this.intelligence + 1.2);

    // bonus reward for building higher
    const reward = 10 + y * 2;
    this.updateQ(state, action, reward, this.getState());

    // evolution
    let evolved = false;
    if (this.successes % 6 === 0) {
      this.generation++;
      this.params.explorationRate = Math.max(0.05, this.params.explorationRate * 0.85);
      evolved = true;
    }

    return {
      type: "place",
      message: `УСПЕХ: блок размещён [${x}, ${y}, ${z}]${evolved ? ` ◆ ЭВОЛЮЦИЯ → GEN ${this.generation}` : ""}`,
      mood: "success",
      reward,
      placedBlock: block,
    };
  }

  private tightenExploration() {
    this.params.explorationRate = Math.max(0.04, this.params.explorationRate * 0.997);
  }

  get successRate(): number {
    return this.attempts > 0 ? Math.round((this.successes / this.attempts) * 100) : 0;
  }

  get qStates(): number {
    return Object.keys(this.qTable).length;
  }
}
