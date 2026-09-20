/**
 * 清点层测试。
 *
 * 这一组测试要守住的核心不变量是：
 * **「工具说可以签字」必须等价于「CI 真的会放过」。**
 *
 * 只要这条不变量破了，工具就在撒谎 —— 而它撒的谎会导致**错误的签字**
 * （人对着一屏「✅ 可以签字」点下去，签的是一个 CI 会打回的条目，或者更糟：
 * 一个其实没核过的条目）。所以这里不只测「功能能用」，而是逐条把
 * 62 个条目都真的推进校验器验一遍。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { confusableWithEdges, contentBundleSchema, validateBundle } from '@dlg/domain';
import { BUNDLE_PATH } from '@dlg/content';
import { loadBundle } from '../src/lib/store.js';
import {
  buildInventory,
  enumerateEntities,
  findProvenance,
  hasHumanSignoff,
  relationEntityId,
  summarize,
} from '../src/lib/inventory.js';
import { cleanupTempBundles } from './helpers.js';

afterAll(cleanupTempBundles);

const { raw, json, bundle } = await loadBundle(BUNDLE_PATH);
const entries = buildInventory(json, raw);

describe('映射一致性 · 工具定位条目的方式必须与 CI 报错一致', () => {
  it('relation 的合成 entity_id 与校验器报错里的字符串逐字符相同', () => {
    // 真实内容库里有 4 对 confusable_with 关系没有任何来源 → R1c 会报它们，
    // 报错里的 entity_id 用的就是这套合成字符串。若两天各写一套，归属就会全部落空。
    const reported = validateBundle(bundle).warnings.filter((w) => w.entity_kind === 'relation').map((w) => w.entity_id);
    expect(reported.length).toBeGreaterThan(0);

    const ours = new Set(entries.filter((e) => e.kind === 'relation').map((e) => e.id));
    for (const id of reported) {
      expect(ours.has(id), `校验器报的 ${id} 在工具的清点里找不到`).toBe(true);
    }

    // 反向：逐条用工具的函数重算，必须与清点结果一致
    for (const r of confusableWithEdges(bundle.relations)) {
      expect(ours.has(relationEntityId(r as unknown as Record<string, unknown>))).toBe(true);
    }
  });

  it('每个带 provenance 的条目都在清点里，且只出现一次', () => {
    const expected = enumerateEntities(json).length;
    expect(entries.length).toBe(expected);

    const seen = new Set<string>();
    for (const e of entries) {
      const key = `${e.kind}|${e.id}`;
      expect(seen.has(key), `重复清点：${key}`).toBe(false);
      seen.add(key);
    }

    // 直接扫原始 JSON 交叉验证：带 provenance 的对象数应当等于清点条目数
    const rawCount = (function count(o: unknown): number {
      if (Array.isArray(o)) return o.reduce<number>((n, x) => n + count(x), 0);
      if (o !== null && typeof o === 'object') {
        let n = 'provenance' in (o as object) ? 1 : 0;
        for (const [k, v] of Object.entries(o as object)) {
          if (k === 'provenance') continue; // 不再往 provenance 里面数
          n += count(v);
        }
        return n;
      }
      return 0;
    })(json);
    expect(entries.length).toBe(rawCount);
  });

  it('findProvenance 能定位每一个清点到的条目', () => {
    for (const e of entries) {
      expect(findProvenance(json, { kind: e.kind, id: e.id }), `定位不到 ${e.kind}/${e.id}`).toBeDefined();
    }
  });
});

describe('不变量 · 「可签字」必须等价于「CI 真的放过」（逐条推进校验器验证）', () => {
  /** 把某条改成 reviewed 后，校验器是否对本条目报 error（走原始 JSON，与工具同一条路） */
  function validatorRejectsPromotion(ref: { kind: string; id: string }): number {
    const probe = structuredClone(json) as Record<string, unknown>;
    const prov = findProvenance(probe, ref as never);
    if (!prov) throw new Error('夹具缺失');
    prov['review_status'] = 'reviewed';
    const parsed = contentBundleSchema.parse(probe);
    return validateBundle(parsed).errors.filter((e) => e.entity_kind === ref.kind && e.entity_id === ref.id).length;
  }

  it('清点说「没有阻塞」的条目，升级后校验器确实不报 error', () => {
    // ⚠️ 不能用真实内容库的现状来测这一条：现在**没有任何条目**满足 R19
    // （45 条复核记录全是 AI 写的），所以「可签字」的集合是空的 ——
    // 拿空集合去断言 `toBeGreaterThan(0)` 会失败，拿空集合去循环则什么都没验。
    // 正确的做法是**造一个满足 R19 的条目**：给它一条「人工 + 证实」的复核记录，
    // 然后再断言「清点说可签 ⇔ 校验器真的放过」。
    const probe = structuredClone(json) as Record<string, unknown>;
    const prov = findProvenance(probe, { kind: 'symbol', id: 'sym.wuxing.木' });
    if (!prov) throw new Error('夹具缺失：应当存在 sym.wuxing.木');
    prov['verifications'] = [
      {
        claim: '五行相生的次序',
        source: { ref: '《春秋繁露·五行对》' },
        checked_by: 'human',
        checked_at: '2026-01-01T00:00:00.000Z',
        outcome: '证实',
      },
    ];

    const signedEntries = buildInventory(probe as Record<string, unknown>, 'synthetic-signed');
    const target = signedEntries.find((e) => e.kind === 'symbol' && e.id === 'sym.wuxing.木');
    expect(target).toBeDefined();
    expect(target?.blockers, '给了人工证实记录后仍有阻塞 —— 清点与 CI 不一致').toEqual([]);

    // 逐条把「清点说可签」的全部条目推进真校验器（这里是造出来的那一份）
    const drafts = signedEntries.filter((e) => e.review_status === 'draft' && e.blockers.length === 0);
    expect(drafts.length).toBeGreaterThan(0);
    for (const e of drafts) {
      const clone = structuredClone(probe);
      const p = findProvenance(clone, { kind: e.kind, id: e.id });
      if (!p) throw new Error('夹具缺失');
      p['review_status'] = 'reviewed';
      const reported = validateBundle(contentBundleSchema.parse(clone)).errors.filter(
        (x) => x.entity_kind === e.kind && x.entity_id === e.id,
      );
      expect(
        reported,
        `清点说 ${e.kind}/${e.id} 可签字，但校验器会打回 —— 工具在撒谎`,
      ).toEqual([]);
    }
  });

  it('清点说「有阻塞」的条目，升级后校验器确实报 error，且规则号一致', () => {
    const blocked = entries.filter((e) => e.review_status === 'draft' && e.blockers.length > 0);
    for (const e of blocked) {
      expect(validatorRejectsPromotion(e), `清点说 ${e.kind}/${e.id} 有阻塞，但校验器放过了`).toBeGreaterThan(0);
    }
  });

  it('清点给出的阻塞规则号，是校验器真的会报的那些', () => {
    for (const e of entries) {
      if (e.blockers.length === 0) continue;
      const probe = structuredClone(json) as Record<string, unknown>;
      const prov = findProvenance(probe, { kind: e.kind, id: e.id });
      if (!prov) throw new Error('夹具缺失');
      prov['review_status'] = 'reviewed';
      const reported = new Set(
        validateBundle(contentBundleSchema.parse(probe))
          .errors.filter((x) => x.entity_kind === e.kind && x.entity_id === e.id)
          .map((x) => x.rule),
      );
      for (const b of e.blockers) {
        expect(reported.has(b.rule), `${e.kind}/${e.id} 的阻塞 ${b.rule} 不在校验器报的 ${[...reported].join(',')} 里`).toBe(true);
      }
    }
  });
});

describe('清点结果反映真实内容库的现状', () => {
  it('全部条目都是 draft（人工签字前应当如此）', () => {
    expect(entries.every((e) => e.review_status === 'draft')).toBe(true);
  });

  it('没有任何条目已满足 R19（所以「现在就能签」必须为 0）', () => {
    // 45 条复核记录全是 AI 写的 → 依 R19 都不构成签字依据。
    // 这条测试的意义：它证明了「有 45 条复核记录」不等于「可以签字」。
    expect(entries.some((e) => e.humanSigned)).toBe(false);
    expect(summarize(entries).humanVerifications).toBe(0);
    expect(summarize(entries).aiVerifications).toBeGreaterThan(0);
    expect(summarize(entries).readyToSign).toBe(0);
  });

  it('教学假设（易混淆对）被标出来 —— 它们不能靠文献升 reviewed', () => {
    const hypotheses = entries.filter((e) => e.isTeachingHypothesis);
    expect(hypotheses.length).toBe(4);
    for (const h of hypotheses) {
      // 这类条目没有来源（R1c 已警告），因此必然有阻塞
      expect(h.blockers.length).toBeGreaterThan(0);
    }
  });

  it('summarize 的分类计数之和等于总数', () => {
    const s = summarize(entries);
    const sum = s.byKind.reduce((n, k) => n + k.total, 0);
    expect(sum).toBe(s.total);
    expect(s.byStatus['draft']).toBe(s.total);
  });
});

describe('hasHumanSignoff · R19 的实质要件', () => {
  it('只有 AI 记录不算', () => {
    expect(
      hasHumanSignoff([
        { claim: 'x', source: { ref: 'y' }, checked_by: 'ai-candidate', checked_at: '2026-01-01T00:00:00.000Z', outcome: '证实' },
      ] as never),
    ).toBe(false);
  });

  it('人工但结论「无法核实」不算', () => {
    expect(
      hasHumanSignoff([
        { claim: 'x', source: { ref: 'y' }, checked_by: 'human', checked_at: '2026-01-01T00:00:00.000Z', outcome: '无法核实' },
      ] as never),
    ).toBe(false);
  });

  it('人工 + 部分证实 算', () => {
    expect(
      hasHumanSignoff([
        { claim: 'x', source: { ref: 'y' }, checked_by: 'human', checked_at: '2026-01-01T00:00:00.000Z', outcome: '部分证实' },
      ] as never),
    ).toBe(true);
  });
});
