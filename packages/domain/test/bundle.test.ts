/**
 * bundle schema 测试 —— 保证 CLI 的 JSON 入口（`validate <file>`）走的是同一条路。
 *
 * 若只测 `validateBundle()` 而不测 `contentBundleSchema`，CLI 路径就没人管，
 * 而 step 2「手写一条真实内容穿过 schema」正是从 JSON 进来的。
 */
import { describe, expect, it } from 'vitest';
import { contentBundleSchema, emptyBundle } from '../src/bundle.js';
import { validBundle } from './fixtures.js';

describe('contentBundleSchema', () => {
  it('空集合可被 parse', () => {
    expect(contentBundleSchema.safeParse(emptyBundle()).success).toBe(true);
  });

  it('最小合法集合可被 parse（step 2 的入口路径）', () => {
    const parsed = contentBundleSchema.safeParse(validBundle());
    expect(parsed.success).toBe(true);
  });

  it('JSON 往返后仍可 parse（CLI 读文件即走这条路）', () => {
    const roundTripped = JSON.parse(JSON.stringify(validBundle()));
    const parsed = contentBundleSchema.safeParse(roundTripped);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.skills[0]?.judging_mode).toBe('Rubric+AI');
    }
  });

  it('缺必填字段的集合被拒绝', () => {
    const bad = { ...emptyBundle(), skills: [{ id: 'x' }] };
    expect(contentBundleSchema.safeParse(bad).success).toBe(false);
  });
});
