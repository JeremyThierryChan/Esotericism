/**
 * @dlg/domain —— 知识架构的类型与 schema（ADR-0008 step 1）
 *
 * 严格分层（V0.1 §2）：
 *   Layer 0 元数据层   provenance.ts
 *   Layer 1 知识本体层 formalism / symbol / system / concept / relation / rule / transfer
 *   Layer 2 能力层     skill
 *   Layer 3 教学层     rubric / assessment
 *
 * ⚠️ 分层硬约束（写代码时不许破）：
 *   · Layer 1 不含任何教学信息
 *   · Layer 2 不含任何顺序，**也不含任何 Rubric 指针**（ADR-0015⑤ / M16）
 *   · Layer 3 可以被整体替换而不动 Layer 1/2
 */

// ---- Layer 0 ----
export * from './layer0/provenance.js';

// ---- Layer 1 ----
export * from './layer1/formalism.js';
export * from './layer1/symbol.js';
export * from './layer1/system.js';
export * from './layer1/concept.js';
export * from './layer1/relation.js';
export * from './layer1/rule.js';
export * from './layer1/transfer.js';

// ---- Layer 2 ----
export * from './layer2/skill.js';

// ---- Layer 3 ----
export * from './layer3/rubric.js';
export * from './layer3/assessment.js';

// ---- 派生视图（机制 A） ----
export * from './derive.js';

// ---- 判分器接口 ----
export * from './judges.js';

// ---- 内容集合与 CI 校验 ----
export * from './bundle.js';
export * from './validate/rules.js';
export * from './validate/forbidden.js';

// ---- 规则引擎 spike（六爻） ----
export * as liuyao from './liuyao/index.js';
