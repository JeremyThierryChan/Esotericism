/**
 * 预览站 · 落库（IndexedDB）
 *
 * 依据：`docs/待采集数据.md` §五（最小落库规格）
 *
 * ⚠️ 为什么是 IndexedDB，而不是 SQLite-WASM：
 *   sqlite-wasm 的 OPFS 模式需要 `SharedArrayBuffer`，而它要求 COOP/COEP 响应头 ——
 *   **GitHub Pages 不能设置自定义响应头**。IndexedDB 是浏览器原生、零依赖、无需任何响应头，
 *   在静态站上直接可用。
 *
 * ⚠️ 三条硬约束（采集规格里定的，这里逐一落实）：
 *   1. `attempt` **只追加** —— 判分结果可重算，但「用户当时选了什么」不可重建
 *   2. `evidence` 是掌握度的**唯一入口**
 *   3. `confusion_pair` 的**预设匹配在写入时算好** —— 事后 join 需要内容库版本，而内容库会变
 */
import type { Attempt, Evidence, JudgeAudit } from '@dlg/domain';

const DB_NAME = 'dlg-preview';
const DB_VERSION = 1;
export const STORES = {
  attempt: 'attempt',
  evidence: 'evidence',
  /** 掌握度快照：否则只能重放全部历史，答不出「当时是多少」 */
  mastery: 'mastery_snapshot',
  score: 'score_entry',
  meta: 'meta',
} as const;

export interface ScoreEntry {
  attempt_id: string;
  exercise_id: string;
  template_id?: string;
  points: number;
  /** 因子明细，用于复盘给分是否合理 */
  factors: Record<string, number | boolean>;
  reasons: string[];
  at: string;
}

export interface MasterySnapshot {
  at: string;
  skill_id: string;
  dimension: string;
  value: number;
  samples: number;
  status: string;
}

/** 一条完整作答事件：作答 + 判分 + 证据 + 积分 + 掌握度快照，一次事务写入 */
export interface AttemptEvent {
  attempt: Attempt;
  evidence: Evidence[];
  score: ScoreEntry;
  mastery: MasterySnapshot[];
}

/**
 * 存储可用性。
 *
 * ⚠️ 必须能优雅降级，有两个真实场景：
 *   ① 隐私模式 / 存储被禁 → `indexedDB` 抛错或不可用
 *   ② 冒烟测试的 DOM 替身里**根本没有 `indexedDB`** → 不降级会让产物直接崩
 * 降级后用内存，并且**明确告诉用户「本次数据不会保存」** —— 不能让人以为攒到了。
 */
export function storageKind(): 'indexeddb' | 'memory' {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null ? 'indexeddb' : 'memory';
  } catch {
    return 'memory';
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.attempt)) {
        const s = db.createObjectStore(STORES.attempt, { keyPath: 'id' });
        s.createIndex('by_exercise', 'exercise_id');
        s.createIndex('by_template', 'template_id');
        s.createIndex('by_time', 'submitted_at');
      }
      if (!db.objectStoreNames.contains(STORES.evidence)) {
        const s = db.createObjectStore(STORES.evidence, { keyPath: 'id' });
        s.createIndex('by_skill', 'skill_id');
      }
      if (!db.objectStoreNames.contains(STORES.mastery)) {
        db.createObjectStore(STORES.mastery, { keyPath: ['at', 'skill_id', 'dimension'] });
      }
      if (!db.objectStoreNames.contains(STORES.score)) {
        db.createObjectStore(STORES.score, { keyPath: 'attempt_id' });
      }
      if (!db.objectStoreNames.contains(STORES.meta)) {
        db.createObjectStore(STORES.meta, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB 打开失败'));
  });
  return dbPromise;
}

function tx<T>(stores: string[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => Promise<T> | T): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(stores, mode);
        let out: T;
        t.oncomplete = () => resolve(out);
        t.onerror = () => reject(t.error ?? new Error('IndexedDB 事务失败'));
        try {
          const r = fn(t);
          if (r instanceof Promise) r.then((v) => (out = v)).catch(reject);
          else out = r;
        } catch (e) {
          reject(e);
        }
      }),
  );
}

function put(store: IDBObjectStore, value: unknown): void {
  store.put(value);
}

function getAll<T>(t: IDBTransaction, store: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const req = t.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

// ── 内存降级（隐私模式 / 无 indexedDB 环境）────────────────────────────────
const mem = {
  attempt: [] as Attempt[],
  evidence: [] as Evidence[],
  score: [] as ScoreEntry[],
  mastery: [] as MasterySnapshot[],
};

/** 写入一条作答事件（一个事务，避免半写） */
export async function recordAttempt(event: AttemptEvent): Promise<void> {
  if (storageKind() === 'memory') {
    mem.attempt.push(event.attempt);
    mem.evidence.push(...event.evidence);
    mem.score.push(event.score);
    mem.mastery.push(...event.mastery);
    return;
  }
  await tx([STORES.attempt, STORES.evidence, STORES.score, STORES.mastery], 'readwrite', (t) => {
    put(t.objectStore(STORES.attempt), event.attempt);
    for (const e of event.evidence) put(t.objectStore(STORES.evidence), e);
    put(t.objectStore(STORES.score), event.score);
    for (const m of event.mastery) put(t.objectStore(STORES.mastery), m);
  });
}

export interface Dump {
  exported_at: string;
  db_version: number;
  /** 数据实际存在哪 —— 导出文件里带上，避免事后分不清数据是否持久化过 */
  storage?: 'indexeddb' | 'memory';
  attempts: Attempt[];
  evidence: Evidence[];
  scores: ScoreEntry[];
  mastery: MasterySnapshot[];
}

/** 导出全部数据（**这是「攒到数据」的关键一步**：不导出就等于只存在浏览器里） */
export async function dumpAll(): Promise<Dump> {
  if (storageKind() === 'memory') {
    return {
      exported_at: new Date().toISOString(),
      db_version: DB_VERSION,
      attempts: [...mem.attempt],
      evidence: [...mem.evidence],
      scores: [...mem.score],
      mastery: [...mem.mastery],
      storage: 'memory',
    } as Dump;
  }
  return tx(
    [STORES.attempt, STORES.evidence, STORES.score, STORES.mastery],
    'readonly',
    async (t) => ({
      exported_at: new Date().toISOString(),
      db_version: DB_VERSION,
      attempts: await getAll<Attempt>(t, STORES.attempt),
      evidence: await getAll<Evidence>(t, STORES.evidence),
      scores: await getAll<ScoreEntry>(t, STORES.score),
      mastery: await getAll<MasterySnapshot>(t, STORES.mastery),
    }),
  );
}

/** 计数（用于 UI 显示「攒了多少」） */
export async function counts(): Promise<Record<string, number>> {
  if (storageKind() === 'memory') {
    return { attempt: mem.attempt.length, evidence: mem.evidence.length, score: mem.score.length, mastery_snapshot: mem.mastery.length };
  }
  return tx([STORES.attempt, STORES.evidence, STORES.score, STORES.mastery], 'readonly', async (t) => ({
    attempt: (await getAll(t, STORES.attempt)).length,
    evidence: (await getAll(t, STORES.evidence)).length,
    score: (await getAll(t, STORES.score)).length,
    mastery_snapshot: (await getAll(t, STORES.mastery)).length,
  }));
}

/** 读取全部作答（分析面板用） */
export async function allAttempts(): Promise<Attempt[]> {
  if (storageKind() === 'memory') return [...mem.attempt];
  return tx([STORES.attempt], 'readonly', (t) => getAll<Attempt>(t, STORES.attempt));
}

/** 清空（自己玩的实验数据可重来；导出后再清） */
export async function clearAll(): Promise<void> {
  if (storageKind() === 'memory') {
    mem.attempt.length = 0;
    mem.evidence.length = 0;
    mem.score.length = 0;
    mem.mastery.length = 0;
    return;
  }
  await tx([STORES.attempt, STORES.evidence, STORES.score, STORES.mastery], 'readwrite', (t) => {
    for (const s of [STORES.attempt, STORES.evidence, STORES.score, STORES.mastery]) t.objectStore(s).clear();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 会话标识（匿名；预览阶段不做账号）
// ─────────────────────────────────────────────────────────────────────────────

const SESSION_KEY = 'dlg.session_id';

export function sessionId(): string {
  try {
    const existing = localStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const fresh = `s.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}`;
    localStorage.setItem(SESSION_KEY, fresh);
    return fresh;
  } catch {
    // localStorage 不可用（隐私模式等）→ 退化为内存会话，不阻塞作答
    return 's.ephemeral';
  }
}

/** 审计记录（V0.1 §12 三道闸门的落库形式）在 attempt.judging.audit 里，此处仅做类型出口 */
export type { JudgeAudit };
