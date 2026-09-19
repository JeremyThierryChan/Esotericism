/**
 * ContentBundle —— 一次构建的完整内容集合
 *
 * CI 校验的输入。校验是**跨实体**的（缺来源、引用完整性、绑定关系、派生一致性），
 * 所以必须有一个容器把 Layer 0–3 全部装进来。
 *
 * 依据：V0.1 §14 流水线（② CI 校验）+ V0.2.1 §4 的 9 条 CI 规则
 */
import { z } from 'zod';

import { provenanceSchema } from './layer0/provenance.js';
import { formalismSchema } from './layer1/formalism.js';
import { attributeSpaceSchema, hasAttributeSchema, symbolSchema, symbolUsageSchema } from './layer1/symbol.js';
import { schoolSchema, systemSchema } from './layer1/system.js';
import { conceptSchema, schemaSchema } from './layer1/concept.js';
import { relationSchema } from './layer1/relation.js';
import { ruleSchema, ruleTestSetSchema } from './layer1/rule.js';
import { transferEdgeSchema } from './layer1/transfer.js';
import { skillEdgeSchema, skillSchema } from './layer2/skill.js';
import { rubricSchema } from './layer3/rubric.js';
import { assessmentSpecSchema } from './layer3/assessment.js';
import { exerciseSchema } from './layer3/exercise.js';
import { exerciseTemplateSchema } from './layer3/exercise-template.js';

export const contentBundleSchema = z.object({
  version: z.number().int().positive(),
  formalism: z.array(formalismSchema),
  attribute_spaces: z.array(attributeSpaceSchema),
  symbols: z.array(symbolSchema),
  has_attributes: z.array(hasAttributeSchema),
  symbol_usages: z.array(symbolUsageSchema),
  systems: z.array(systemSchema),
  schools: z.array(schoolSchema),
  concepts: z.array(conceptSchema),
  schemas: z.array(schemaSchema),
  relations: z.array(relationSchema),
  rules: z.array(ruleSchema),
  rule_test_sets: z.array(ruleTestSetSchema),
  transfer_edges: z.array(transferEdgeSchema),
  skills: z.array(skillSchema),
  skill_edges: z.array(skillEdgeSchema),
  rubrics: z.array(rubricSchema),
  assessment_specs: z.array(assessmentSpecSchema),
  exercises: z.array(exerciseSchema),
  exercise_templates: z.array(exerciseTemplateSchema),
  /**
   * 待检查的**自然语言内容文本**（课程文案、题目、解释）。
   * 禁用语检查（CI 规则 R9）扫描这里，而不是扫描 schema 字段。
   */
  content_texts: z
    .array(
      z.object({
        id: z.string().min(1),
        /** 该文本属于哪条内容（用于报错定位） */
        owner_id: z.string().min(1),
        text: z.string(),
      }),
    )
    .default([]),
});

export type ContentBundle = z.infer<typeof contentBundleSchema>;

/** 空 bundle（测试与 step 2 的起点） */
export function emptyBundle(): ContentBundle {
  return {
    version: 1,
    formalism: [],
    attribute_spaces: [],
    symbols: [],
    has_attributes: [],
    symbol_usages: [],
    systems: [],
    schools: [],
    concepts: [],
    schemas: [],
    relations: [],
    rules: [],
    rule_test_sets: [],
    transfer_edges: [],
    skills: [],
    skill_edges: [],
    rubrics: [],
    assessment_specs: [],
    exercises: [],
    exercise_templates: [],
    content_texts: [],
  };
}

export { provenanceSchema };
