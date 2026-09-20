# @dlg/studio · 内容流水线工具

> ADR-0008 指定的「第一个要写的 UI」· 缺口清单 **C2-2**
> 设计记录与取舍：[`docs/work/ADR-0026-内容流水线工具.md`](../../docs/work/ADR-0026-内容流水线工具.md)

**本机工具，不上线、不部署。** 它直接改写内容的唯一事实来源
（`packages/content/bundle.json`），所以刻意只绑 `127.0.0.1`，并校验 `Host` 头防 DNS rebinding。

## 用法

```bash
# 界面（默认 http://127.0.0.1:4180/）
pnpm --filter @dlg/studio serve

# 不开浏览器，直接在终端看「现在能不能签字」
pnpm --filter @dlg/studio check

# 测试 / 构建（build = typecheck + 端到端冒烟）
pnpm --filter @dlg/studio test
pnpm --filter @dlg/studio build

# 指向别的内容库（测试与演练用；**测试绝不能碰真实文件**）
DLG_BUNDLE=/tmp/bundle.json pnpm --filter @dlg/studio serve
```

## 三屏

| 屏 | 回答什么问题 |
|---|---|
| **总览** | 有多少条目、多少可签字、AI 复核记录 vs 人工复核记录各多少 |
| **审核工作台** | 选一条 → 看到「卡在哪」（**由真 CI 校验器算出**）→ 记人工复核 → 签字 / 撤回 |
| **录入** | 选集合 → JSON → 校验 → 保存；可从现有条目克隆骨架、可看合法引用清单 |
| **试玩预览** | 每个模板能生成多少题、样题与正确答案 |

## 三条要知道的约束

1. **「能不能签字」不自己算。** 工具把条目推进**真正的** `validateBundle` 取结论，
   所以它不会说「可以签字」而 CI 说「不行」。
2. **只能写 `checked_by: 'human'`。** 没有写 AI 复核记录的入口 —— 否则 R1b/R19 会被合规地绕过。
3. **写回的是原始 JSON，不是 zod 的输出。** zod 会改键序、补默认值，拿它的输出写回会产生
   上千行 diff（详见 ADR-0026 §三③）。`store.test.ts` 用测试锁死了这条。

## 安全边界

| 措施 | 为什么 |
|---|---|
| 只监听 `127.0.0.1` | 局域网不可达 |
| 校验 `Host` 头必须是 localhost / 127.0.0.1 | 防 DNS rebinding（只绑本机挡不住） |
| 静态文件走 3 个文件名的白名单 | 无目录穿越面 |
| 写前写后都校验，失败**自动回滚** | 唯一事实来源不许写坏 |
| `undo` 只在进程内存里 | 长期历史是 **git**；工具不假装自己是版本控制 |

**改动前请看 `git diff`。** 工具会原子写、会回滚、会给你一次 undo，
但它不是备份 —— 真正的备份是 git。
