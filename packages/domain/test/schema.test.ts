/**
 * Schema 形状测试 —— 锁住 ADR-0009–0015 的决策，防止无声回退。
 *
 * 这些断言的价值在于：任何"顺手把 family 加回来""把 Attribute 实体加回来"
 * "把 transfer_type 恢复成 5 个值"的改动都会在这里失败。
 */
import { describe, expect, it } from 'vitest';
import { FORMALISM_IDS, formalismIdSchema } from '../src/layer1/formalism.js';
import { symbolSchema } from '../src/layer1/symbol.js';
import { systemSchema } from '../src/layer1/system.js';
import { TRANSFER_TYPES, transferEdgeSchema } from '../src/layer1/transfer.js';
import { SCHEMA_IDS } from '../src/layer1/concept.js';
import { RUBRIC_JUDGING_MODES, skillSchema } from '../src/layer2/skill.js';
import { sourceStrengthSchema, provenanceSchema } from '../src/layer0/provenance.js';
import { humanProvenance } from './fixtures.js';

describe('ADR-0009 · Formalism 清单是 4 个固定项', () => {
  it('恰好 4 个，且不是"东方/西方"两分', () => {
    expect([...FORMALISM_IDS]).toEqual([
      'east-xiangshu',
      'greek-four-elements',
      'planetary-zodiac',
      'tarot-symbolic',
    ]);
  });

  it('拒绝未知 Formalism id', () => {
    expect(formalismIdSchema.safeParse('western-esoteric').success).toBe(false);
  });
});

describe('ADR-0010 · Symbol 归属 Formalism，属性取值是 Symbol', () => {
  it('Symbol 带 formalism_id 且不需要 system_id', () => {
    const parsed = symbolSchema.safeParse({
      id: 'sym.wuxing.木',
      formalism_id: 'east-xiangshu',
      canonical_name: '木',
      symbol_kind: 'attribute_value',
      attribute_space_id: 'space.wuxing',
      provenance: humanProvenance(),
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty('system_id');
      expect(parsed.data.symbol_kind).toBe('attribute_value');
    }
  });
});

describe('ADR-0015④ · System 不带 family', () => {
  it('systemSchema 的字段中不存在 family', () => {
    const keys = Object.keys(systemSchema.shape);
    expect(keys).not.toContain('family');
    expect(keys).toContain('default_school_id');
  });

  it('七政四余可以引用两个 Formalism（这是删除 family 的理由）', () => {
    const parsed = systemSchema.safeParse({
      id: 'system.qizhengsiyu',
      name: '七政四余',
      default_school_id: 'school.x',
      formalism_ids: ['east-xiangshu', 'planetary-zodiac'],
      provenance: humanProvenance(),
    });
    expect(parsed.success).toBe(true);
  });
});

describe('ADR-0011 · transfer_type 只有三个值', () => {
  it('枚举为 {3,4,5}，不含 1 / 2', () => {
    expect([...TRANSFER_TYPES]).toEqual([3, 4, 5]);
  });

  it('拒绝类型 1 与类型 2（它们已降级为派生视图）', () => {
    for (const t of [1, 2]) {
      const parsed = transferEdgeSchema.safeParse({
        id: 'e',
        from_node_id: 'a',
        to_node_id: 'b',
        transfer_type: t,
        source_strength: '高',
        sources: [{ ref: 'x' }],
      });
      expect(parsed.success).toBe(false);
    }
  });
});

describe('ADR-0015⑤ · Layer 2 不含 Rubric 指针（M16）', () => {
  it('skillSchema 没有 rubric_id / rule_ids 字段', () => {
    const keys = Object.keys(skillSchema.shape);
    expect(keys).not.toContain('rubric_id');
    expect(keys).not.toContain('rule_ids');
    expect(keys).toContain('judging_mode');
    expect(keys).toContain('kind');
  });

  it('过程Rubric+AI 属于需要 Rubric 的判分方式', () => {
    expect([...RUBRIC_JUDGING_MODES]).toContain('过程Rubric+AI');
  });
});

describe('ADR-0015① · 认知图式为 S1–S9', () => {
  it('9 个，且 S9 存在', () => {
    expect([...SCHEMA_IDS]).toHaveLength(9);
    expect([...SCHEMA_IDS]).toContain('S9');
  });
});

describe('ADR-0015⑥ · 来源强度（原名证据强度）', () => {
  it('字段名为 source_strength，不接受 evidence_strength', () => {
    const good = provenanceSchema.safeParse({ sources: [], source_strength: '高' });
    expect(good.success).toBe(true);
    expect(sourceStrengthSchema.safeParse('高').success).toBe(true);
    expect(sourceStrengthSchema.safeParse('很高').success).toBe(false);
  });
});

describe('ADR-0012 · 来源条目允许只填书名+作者（年份可空且不得编造）', () => {
  it('无 year 合法', () => {
    const parsed = provenanceSchema.safeParse({
      sources: [{ ref: '《增删卜易》', author: '清·野鹤老人（李文辉编校刊行）', confidence: '中–高' }],
      source_strength: '中',
    });
    expect(parsed.success).toBe(true);
  });
});
