/**
 * 审核操作测试 —— 走的是**真实内容库的副本**，每个用例都在临时文件上写。
 *
 * 这里要守的两条：
 *   ① **签字必须过真 CI 门**：升级后重新读回文件、重跑校验器，必须没有 error；
 *   ② **工具写不出 AI 复核记录**：`verifications[]` 里新增的记录一律 `checked_by: human`。
 *      这是认识论原则 3 的入口级防线（见 review.ts 顶部说明）。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { validateBundle } from '@dlg/domain';
import { BUNDLE_PATH } from '@dlg/content';
import { buildInventory, type EntityRef } from '../src/lib/inventory.js';
import { loadBundle, readRaw, resolveBundlePath, serializeBundle } from '../src/lib/store.js';
import { demote, promote, recordVerification, ReviewError } from '../src/lib/review.js';
import { cleanupTempBundles, withTempBundle } from './helpers.js';

afterAll(cleanupTempBundles);

const NAME = '测试签字人';

/** 挑一个真实存在的、有来源的 draft 条目作为操作对象 */
async function pickTarget(path: string): Promise<EntityRef> {
  const { raw, json } = await loadBundle(path);
  const e = buildInventory(json, raw).find((x) => x.kind === 'symbol' && x.review_status === 'draft');
  if (!e) throw new Error('夹具缺失：真实内容库里应当有 draft 状态的 symbol');
  return { kind: e.kind, id: e.id };
}

describe('记人工复核记录', () => {
  it('写入成功，且文件仍然逐字节可往返（没有格式漂移）', async () => {
    await withTempBundle(async (path) => {
      const ref = await pickTarget(path);
      const r = await recordVerification(
        ref,
        {
          claim: '五行相生的次序自《春秋繁露·五行对》',
          source: { ref: '《春秋繁露·五行对》', author: '汉·董仲舒', confidence: '中–高' },
          locator: '五行对第三十八',
          excerpt: '天有五行：一曰木，二曰火，三曰土，四曰金，五曰水。',
          outcome: '证实',
        },
        NAME,
        path,
      );

      expect(r.entry.humanSigned).toBe(true);
      expect(r.entry.verifications.at(-1)?.checked_by).toBe('human');
      expect(r.entry.verifications.at(-1)?.locator).toBe('五行对第三十八');

      // 格式不变：读回来重新序列化必须等于磁盘上的字节
      const after = await readRaw(path);
      const { json } = await loadBundle(path);
      expect(serializeBundle(json)).toBe(after);
    });
  });

  it('**只会写 checked_by: human** —— 新记录里不存在 ai-candidate', async () => {
    await withTempBundle(async (path) => {
      const ref = await pickTarget(path);
      const before = await loadBundle(path);
      const beforeCount = before.bundle.symbols.find((s) => s.id === ref.id)?.provenance.verifications.length ?? 0;

      const r = await recordVerification(
        ref,
        { claim: 'x', source: { ref: 'y' }, outcome: '证实' },
        NAME,
        path,
      );

      const added = r.entry.verifications.slice(beforeCount);
      expect(added.length).toBe(1);
      expect(added.every((v) => v.checked_by === 'human')).toBe(true);
    });
  });

  it('既有记录被保留（复核记录是审计链，只追加不改写）', async () => {
    await withTempBundle(async (path) => {
      const ref = await pickTarget(path);
      const { bundle } = await loadBundle(path);
      const before = bundle.symbols.find((s) => s.id === ref.id)?.provenance.verifications ?? [];

      const r = await recordVerification(ref, { claim: 'x', source: { ref: 'y' }, outcome: '证实' }, NAME, path);

      expect(r.entry.verifications.slice(0, before.length)).toEqual(before);
    });
  });

  it('没有署名 → 拒绝（没有署名的复核记录不构成签字）', async () => {
    await withTempBundle(async (path) => {
      const ref = await pickTarget(path);
      await expect(
        recordVerification(ref, { claim: 'x', source: { ref: 'y' }, outcome: '证实' }, '   ', path),
      ).rejects.toThrow(/署名|复核人/);
    });
  });

  it('没有具体论断 → 拒绝', async () => {
    await withTempBundle(async (path) => {
      const ref = await pickTarget(path);
      await expect(
        recordVerification(ref, { claim: '  ', source: { ref: 'y' }, outcome: '证实' }, NAME, path),
      ).rejects.toThrow(/论断/);
    });
  });

  it('定位不到条目 → 报错，不乱写别处', async () => {
    await withTempBundle(async (path) => {
      await expect(
        recordVerification({ kind: 'symbol', id: 'sym.不存在的符号' }, { claim: 'x', source: { ref: 'y' }, outcome: '证实' }, NAME, path),
      ).rejects.toThrow(/定位不到/);
    });
  });
});

describe('签字（升 reviewed）必须过真 CI 门', () => {
  it('只有 AI 复核记录时不能签字，且报出 R19', async () => {
    await withTempBundle(async (path) => {
      const ref = await pickTarget(path);
      const err = await promote(ref, NAME, path).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ReviewError);
      const blockers = (err as ReviewError).blockers;
      expect(blockers.map((b) => b.rule)).toContain('R19');
    });
  });

  it('人工复核但结论「无法核实」仍不能签字', async () => {
    await withTempBundle(async (path) => {
      const ref = await pickTarget(path);
      await recordVerification(ref, { claim: 'x', source: { ref: 'y' }, outcome: '无法核实' }, NAME, path);
      await expect(promote(ref, NAME, path)).rejects.toThrow(/R19/);
    });
  });

  it('人工 + 证实 → 签字成功，且重新读回后 CI 无 error', async () => {
    await withTempBundle(async (path) => {
      const ref = await pickTarget(path);
      await recordVerification(ref, { claim: 'x', source: { ref: 'y' }, outcome: '证实' }, NAME, path);
      const r = await promote(ref, NAME, path);

      expect(r.entry.review_status).toBe('reviewed');
      expect(r.entry.reviewer).toBe(NAME);
      expect(r.entry.reviewed_at).toBeDefined();

      // 终局断言：磁盘上的文件必须真的过 CI
      const { bundle } = await loadBundle(path);
      const report = validateBundle(bundle);
      const mine = report.errors.filter((e) => e.entity_kind === ref.kind && e.entity_id === ref.id);
      expect(mine).toEqual([]);
    });
  });

  it('没有署名 → 拒绝签字', async () => {
    await withTempBundle(async (path) => {
      const ref = await pickTarget(path);
      await expect(promote(ref, '  ', path)).rejects.toThrow(/签字人|署名/);
    });
  });

  it('已经 reviewed 的条目再签 → 报错（不重复签）', async () => {
    await withTempBundle(async (path) => {
      const ref = await pickTarget(path);
      await recordVerification(ref, { claim: 'x', source: { ref: 'y' }, outcome: '证实' }, NAME, path);
      await promote(ref, NAME, path);
      await expect(promote(ref, NAME, path)).rejects.toThrow(/已经是 reviewed/);
    });
  });
});

describe('撤回（回 draft）—— 让「谨慎签字」这个要求站得住', () => {
  it('撤回后状态回 draft，verifications 保留，reviewer/reviewed_at 被清掉', async () => {
    await withTempBundle(async (path) => {
      const ref = await pickTarget(path);
      await recordVerification(ref, { claim: 'x', source: { ref: 'y' }, outcome: '证实' }, NAME, path);
      const signed = await promote(ref, NAME, path);
      const r = await demote(ref, path);

      expect(r.entry.review_status).toBe('draft');
      expect(r.entry.reviewer).toBeUndefined();
      expect(r.entry.reviewed_at).toBeUndefined();
      expect(r.entry.verifications).toEqual(signed.entry.verifications);
      expect(r.entry.verifications.length).toBeGreaterThan(0);
    });
  });

  it('撤回后可以再签（可逆）', async () => {
    await withTempBundle(async (path) => {
      const ref = await pickTarget(path);
      await recordVerification(ref, { claim: 'x', source: { ref: 'y' }, outcome: '证实' }, NAME, path);
      await promote(ref, NAME, path);
      await demote(ref, path);
      const again = await promote(ref, NAME, path);
      expect(again.entry.review_status).toBe('reviewed');
    });
  });

  it('非 reviewed 的条目撤回 → 报错', async () => {
    await withTempBundle(async (path) => {
      const ref = await pickTarget(path);
      await expect(demote(ref, path)).rejects.toThrow(/不是 reviewed/);
    });
  });
});

describe('路径解析', () => {
  it('不传 path 时用当前内容库路径（测试里绝不落到真实文件）', async () => {
    await withTempBundle(async (path) => {
      const old = process.env['DLG_BUNDLE'];
      process.env['DLG_BUNDLE'] = path;
      try {
        expect(resolveBundlePath()).toBe(path);
      } finally {
        if (old === undefined) delete process.env['DLG_BUNDLE'];
        else process.env['DLG_BUNDLE'] = old;
      }
    });
  });

  it('真实内容库路径常量指向 packages/content/bundle.json', () => {
    expect(BUNDLE_PATH.endsWith('packages/content/bundle.json')).toBe(true);
  });
});
