/**
 * 试玩预览：**在浏览器里看题目长什么样，再决定要不要进内容库**。
 *
 * ADR-0008 要的「试玩预览」不是玩，而是「看清将要上线的东西」。
 * 题目是**生成**出来的（ADR-0021：模板 + 规则引擎确定性组合），
 * 所以内容作者改一条关系边、改一行规则表，题目会**整体变化** —— 这件事必须能先看见。
 *
 * 这一层只读：调用 `generateExercises`（纯函数、确定性），不碰磁盘。
 */
import { generateExercises, validateBundle, type ContentBundle, type ValidationReport } from '@dlg/domain';

export interface PreviewSample {
  id: string;
  prompt: string;
  /** 规则算出的正确答案（选择题的判定值） */
  answer: string;
  choices: string[];
  difficulty: string;
  requiresProcess: boolean;
  /** 生成参数（复现用） */
  params: Record<string, string>;
}

export interface PreviewTemplate {
  template_id: string;
  name: string;
  mode: string;
  /** 本模板实际能生成多少题 */
  count: number;
  /** 生成上限（`max_instances`）—— 用来判断 count 是被上限截断还是自然穷尽 */
  max_instances: number;
  /** 被规则拒绝/跳过的输入及原因（**不是**错误，可能是正常的规则边界） */
  skipped: string[];
  skillIds: string[];
  samples: PreviewSample[];
  difficulty: string;
}

export interface PreviewReport {
  total: number;
  templates: PreviewTemplate[];
  /** 报告自带的 CI 结论：题数只有在 CI 通过时才可信（与 count CLI 同一立场） */
  validation: ValidationReport;
}

export function preview(bundle: ContentBundle, sampleLimit = 8): PreviewReport {
  const gen = generateExercises(bundle);
  const report = validateBundle(bundle);

  const templates: PreviewTemplate[] = gen.byTemplate.map((t) => {
    const tpl = bundle.exercise_templates.find((x) => x.id === t.template_id);
    const samples = gen.instances
      .filter((i) => i.template_id === t.template_id)
      .slice(0, sampleLimit)
      .map((i): PreviewSample => {
        const expected = i.answer_key.expected as { label?: unknown } | null;
        const label = expected !== null && typeof expected === 'object' ? expected.label : undefined;
        return {
          id: i.id,
          prompt: i.prompt,
          answer: label === undefined ? '（无 label，见答案键）' : String(label),
          choices: i.answer_key.choices ?? [],
          difficulty: i.difficulty,
          requiresProcess: i.requires_process,
          params: i.params,
        };
      });

    return {
      template_id: t.template_id,
      name: tpl?.name ?? '（未知模板）',
      mode: tpl?.parameter_space.mode ?? '?',
      count: t.count,
      max_instances: tpl?.max_instances ?? 0,
      skipped: t.skipped,
      skillIds: tpl?.skill_ids ?? [],
      samples,
      difficulty: tpl?.difficulty ?? '?',
    };
  });

  return { total: gen.instances.length, templates, validation: report };
}
