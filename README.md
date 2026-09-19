# 术数学习游戏 · 项目文档索引

> 一句话定位：**像学语言一样学术数** —— 通过已经掌握的一套术数，学习另一套术数。
>
> 当前状态：**V0 阶段完成（术语与边界）**，V0.1 知识架构草案已产出。**尚未编写任何代码。**

---

## 一、工作方式约定

1. 每个阶段只产出**设计文档 + 决策点**，不写业务代码。
2. 每个决策点必须给出 2 个以上方案、优缺点、明确推荐。
3. 由人类决策后才进入下一阶段；AI 不代替决策。
4. 发现设计逻辑问题必须直接指出，不得为了顺畅而附和。
5. **AI 不生成未经人工审核的术数理论。** AI 可以产出「候选内容」，但候选 == 未上线。
6. 文档本身遵守产品的来源标注规则：凡声明事实处标注来源与置信度；无法核实处标注「未核实」，不填补。

## 二、文档地图

| 文档 | 阶段 | 内容 | 状态 |
|---|---|---|---|
| `README.md` | — | 索引、阶段路线、决策记录 | 生效 |
| `docs/V0-术语与边界.md` | V0 | 术语表、认识论原则、非目标清单、伦理边界 | 完成 |
| `docs/V0.1-知识架构.md` | V0.1 | 四层图模型、迁移类型学、Mastery 维度、Rubric、AI/规则分工、内容审核流水线、**9 条 CI 规则** | 草案待评审 |
| `docs/research/R1-跨体系对应事实核查.md` | 支撑 | 跨体系对应的历史证据核实（外部研究产出，**状态 `draft`，人工复核后方可升 `reviewed`**） | ⚠️ 待复核 |
| `docs/V0.2-技能树与压力测试.md` | V0.2 | 塔罗深做 + 六爻压力测试 + **18 项模型修订（M1–M18）**，§8 已全部定案 | ✅ 草案待评审 |
| `docs/V0.2.1-架构决定清单.md` | V0.2.1 | **step 1 前置决定清单**：复核 §8 四项 + 新增 M12–M18（M1 的 4 处未闭合）+ 修订版 schema 与 CI 规则 | ✅ 已定案（ADR-0009–0015） |
| `packages/domain/SPIKE-REPORT.md` | step 1 | **step 1 完成报告**：ADR→代码映射、抓到的接口缺陷、未审核数据警示、step 2 输入 | ✅ 完成 |
| `docs/V0.3-跨体系图谱.md` | V0.3 | 迁移图谱 | 未开始 |
| `docs/V0.4-课程系统.md` | V0.4 | 课程/单元/关卡编排 | 未开始 |
| `docs/V0.5-练习系统.md` | V0.5 | 题型与判分 | 未开始 |
| `docs/V0.6-掌握度与复习.md` | V0.6 | Mastery 算法、SRS、混淆对 | 未开始 |
| `docs/V0.7-游戏化.md` | V0.7 | 学习行为→激励映射、XP/streak | 未开始 |
| `docs/V0.8-AI-Tutor.md` | V0.8 | AI 角色、评测集、反幻觉约束 | 未开始 |
| `docs/V0.9-MVP架构.md` | V0.9 | 数据模型、API 契约、内容流水线 | 未开始 |
| `docs/V1.0-UI.md` | V1.0 | 界面与交互 | 未开始 |

## 三、阶段路线

```
V0    术语与边界          ← 本文档 + docs/V0          ✅
V0.1  知识架构                                     ✅ 草案
V0.2  技能树（塔罗深做 + 六爻压力测试）              ✅ 草案 · 18 项模型修订（M1–M18）
V0.2.1 架构决定清单（step 1 前置）                  ✅ 已定案 · ADR-0009–0015
────── ADR-0008 开发顺序 ──────────────────────────────────────────
step 1  packages/domain + schema + CI 校验 + spike   ✅ 完成
step 2  手写一条真实内容穿过 schema                   ⬜ 下一步
step 3  试玩预览页 + AI 判分闭环 + 私有部署            ⬜
step 4  自己当用户玩两周                              ⬜
step 5  学习者端 UI                                  ⬜
step 6  内容规模化                                   ⬜
────── 设计文档阶段（step 5 之后才需要）────────────────────────────
V0.3  跨体系知识图谱                                ⬜
V0.4  课程系统                                      ⬜
V0.5  练习题系统                                    ⬜
V0.6  Mastery / 复习算法                            ⬜
V0.7  游戏化                                        ⬜
V0.8  AI Tutor                                      ⬜
V0.9  MVP 产品架构                                  ⬜
V1.0  UI / 前端                                     ⬜
```

**V0.2 是全项目最关键的一次验证**：用塔罗一门设计的模型必然自洽，必须用第二门体系（六爻）反压，才能证明抽象是真的。此时修改模型的成本最低。

## 四、决策记录（ADR）

| 编号 | 决策 | 结论 | 状态 |
|---|---|---|---|
| ADR-0001 | 技术栈形态 | Next.js 单体全栈 + `packages/domain` 纯净隔离（未来可抽为独立 API） | 已定 |
| ADR-0002 | 图数据存储 | 用 PostgreSQL 邻接表 + 递归 CTE 做图，**不引入图数据库** | 已定 |
| ADR-0003 | MVP 策略 | 纵向切片：1 体系（塔罗）+ 1 跨体系节点 + 1 开放题 AI 反馈 | 已定 |
| ADR-0004 | 产品能力终点 | 教到能对他人实战断事（scope C）；但**实战的考核对象是过程规范性，不是预测准确率** | 已定 |
| ADR-0005 | 代码仓库位置 | **已执行**：项目已移出 iCloud，现位于 `~/玄学与神秘学学习游戏`（本地非同步目录）。`git` / `node_modules` 可直接建在仓库内 | 已执行 |
| ADR-0006 | 流派处理策略 | **分阶段**：入门阶段每体系锁定一个 `default_school`（单一流派，界面干净）；达到 B2 后解锁「流派对比」课程。**数据模型从第一天就必须支持多流派**，只是入门内容不暴露 | 已定 |
| ADR-0007 | 无证据类比的准入 | **允许进入产品**，但必须满足三条硬约束：①显式「类比」标注（UI 可见）②强制四段式结构（V0.1 §8.2）③必须配**反向练习**（找出类比失效的场景） | 已定 |
| ADR-0008 | 开发顺序 | **先做内容流水线 + 试玩闭环，最后做学习者端 UI**：V0.2 设计 → `domain`+schema+CI 校验 → 手写一条真实内容 → 试玩页 + AI 判分闭环 → 私有部署 → 自用两周 → 才设计学习者端 | 已定 |
| ADR-0009 | `Formalism` 层与「共享 Symbol」判据（M1 + M12） | 引入 `Formalism` 层。判据 = **「符号集是同一套，且符号间规则可互相定义」**（不是文化圈）。清单 4 个：①东方象数（阴阳·五行·干支·八卦）②希腊四元素 ③行星黄道（占星）④塔罗象征系统。塔罗的原生符号归 ④；行星/星座经 `transfers_as`(类型3, `historicity=重建`) 引入塔罗；四元素由塔罗与占星共享（机制 A） | 已定 |
| ADR-0010 | `Attribute` 与 `Symbol` 的边界（M13） | 新增 **`AttributeSpace`**（五行/四元素/阴阳/极性/数字）为 Formalism 级分类；**其取值是 `Symbol`**；原 `Attribute` 退化为赋值边 `has_attribute(symbol → value_symbol, space_id)`。判据：凡需被 `Rule` 作用、需携带来源与流派、需参与有向关系的对象，必须是一等节点 | 已定 |
| ADR-0011 | `transfers_as.transfer_type` 枚举（M15） | 收窄为 **{3 历史影响, 4 功能类比, 5 修辞比喻}**。类型 1（同源同构）/2（共享形式系统）**不再产生边**，改为派生视图 `same_formalism_projection`（由 `Formalism`+`SymbolUsage`+`Rule` 自动算出，不落库） | 已定 |
| ADR-0012 | `School` 的锚点（M11） | `School` 新增 `anchor_sources[]`，**以「可引证文献」为锚**（如「本课程依据《增删卜易》一路的取法」）；入门 `default_school` 必须绑定至少一部可引证文献。**不得使用「古法/新派」这类无学术界定的当代实务分类作锚**。年份字段**可空且不得编造**（R1 仅核实书名与作者） | 已定 |
| ADR-0013 | B0 基础层教学材料（M8 + M18） | **采用四体系混合样本**，但收紧准入：①B0 样本**只能取流派无关的符号层操作**（阴阳爻、正逆位、五行生克的**方向**、干支顺序、元素分组依据）②涉及取象/取用神/取体用者，**只允许以「同一操作在不同体系取法不同、且存在争议」的形式呈现**③每个样本必须带 `sources[]`，涉流派分歧者带 `school_id`/`controversy_flag`；缺来源不得进入 B0 | 已定 |
| ADR-0014 | MVP 的跨体系节点 | 选 **B：塔罗 ↔ 占星**（类型 3 历史影响，`historicity = 重建`，evidence 中–高：Lévi 1856 → Golden Dawn *Book T* 1888）。**取代 V0.1 §13 原定的 A（六爻动爻↔牌组演化）**，A 留待后续。反向练习用 R1 Q1.6 的 **RWS/托特 VIII–XI 次序颠倒**（可查证史实） | 已定 |
| ADR-0015 | 低影响批量项 | ①S9 取象/命题按新增处理（M3）②塔罗**逆位默认启用**，B2 对比课讲「为何有传统不用逆位」③梅花体用「不自洽」作为 **B2 流派对比第一课的内容**，不隐藏 ④删除 `System.family`（M14）⑤判分绑定校验移到 **Layer 3**（M16）⑥`EvidenceStrength` → **`SourceStrength`**（M17） | 已定 |

### ADR-0009–0015 为什么必须先于 step 1 定案

`M12/M13/M15` 三项决定的都是**每个知识条目都要填的字段取值域**（`symbol_id` 指向共享节点还是新节点、五行是属性还是符号、`transfer_type` 枚举有哪些值）。schema 一旦写进内容条目，事后补齐 = 重写全部内容——与 ADR-0006 当初要求 `school_id` 预留字段是同一个道理（V0.1 §16.1）。

### ADR-0008 后果（开发顺序）

**理由：** UI 是数据模型的派生物；内容的**体量**不是瓶颈，内容的**格式**才是。格式只能靠端到端打通一次来发现。

| 步骤 | 内容 | 验收标准 | 状态 |
|---|---|---|---|
| 0 | V0.2 塔罗技能树 + 六爻压力测试（纯文档） | 模型能容纳第二门体系 | ✅ |
| 1 | `packages/domain`：类型 + zod schema + CI 校验规则 | 缺来源 / 缺迁移类型的内容构建失败 | ✅ **完成**（`packages/domain/SPIKE-REPORT.md`） |
| 2 | 手写**一条真实内容**穿过 schema | 内容通过校验并入库 | ⬜ 下一步 |
| 3 | 试玩预览页 + AI 按 Rubric 判分闭环 + 落库 → 私有部署 | 提交真实答案 → 六段式反馈且过程可审计（验证 H4） | ⬜ |
| 4 | 自己当用户玩两周（30–50 题切片） | 拿到 Mastery 向量与混淆对数据 | ⬜ |
| 5 | 此时才设计学习者端 UI | 需求第一次变成真的 | ⬜ |
| 6 | 内容规模化 | 格式已锁定 | ⬜ |

**step 1 的实测结果（2026-09-19）：**

- `pnpm typecheck` 干净；`pnpm test` **68 条全过**；`pnpm validate` 退出码可接 CI；`pnpm spike` 报告通过
- **9 条 CI 规则全部有对应测试且都能被触发** —— 否则规则只是注释
- **spike 首次运行即抓到一个接口缺陷**：`palace_element` 字段名与内容不符（装的是八宫表整行，不是五行）。这是**表驱动规则独有的失败形态**，若只按原计划做 L2.1 就发现不了，之后修正 = 重写全部世应相关条目。V0.2 §6 那句「一天的成本，避免塔罗做完才发现规则引擎接口设计不下去」由此得到实证
- ⚠️ `src/liuyao/tables.ts` 的八宫卦序表是 **AI 起草的 draft 候选，未经人工复核**，不得进入 `reviewed`，不得用于教学或判分


**注意：** 第一个要写的 UI 不是学习者端，而是**内容流水线工具**（录入 / 审核 / 试玩预览）。它同时是内容产线与技术风险集中点。**早期部署到私有 URL，公开上线则要晚。**

### ADR 后果（必须落到模型里，不是备注）

- **ADR-0006 →** `System` 需带 `default_school_id`；`School` 是一等实体；`Concept`/`Symbol`/`Rule` 都可挂 `school_id`。入门课程只查 `default_school`，对比课程用 `variant_of` + `contradicts` 取全部流派。**不允许**先用单一流派的扁平模型、以后再补——那会污染所有已写的内容条目。
- **ADR-0006 →** 「流派对比」是一类**新的课程形态**（同一概念多流派并列），需要独立题型与 Rubric 分支，V0.4 必须覆盖。
- **ADR-0007 →** `transfer_type = 4` 的边**必须有配对的反向练习题**，否则 CI 构建失败（是校验规则，不是建议）。
- **ADR-0009 →** `Symbol` 归属 `Formalism`（`Symbol.formalism_id`），`System` 通过 `SymbolUsage` 使用符号。**共享 Symbol 只在同一 Formalism 内成立**；跨 Formalism 一律是 `transfers_as` 边。
- **ADR-0010 →** 生克/冲合/相位是 `Symbol ↔ Symbol` 关系；`Attribute` 不再是独立实体，改为 `has_attribute` 边。V0 术语表「水元素是属性，不是符号」一条**已改写**（其取值现为符号）。
- **ADR-0011 →** `transfer_type` 枚举只有 3 个值；**V0.1 §5.1 的类型 1/2 不再是迁移类型**，而是派生视图 `same_formalism_projection`。
- **ADR-0012 →** `School.anchor_sources[]` 非空是入门 `default_school` 的**上线前提**（CI 校验）。
- **ADR-0014 →** V0.1 §13 的 MVP 定义**已改写**（A→B）；跨体系关卡四段式中第 ④ 段的「反向练习」内容随之改为「指出 Golden Dawn 行星/星座指派的可争议处」——素材用 R1 Q1.6 的 RWS/托特 VIII–XI 次序颠倒。
- **ADR-0015 →** `System` **不带 `family`**（七政四余同时引用两个 Formalism，二值字段无法容纳）；`Rubric` 绑定校验发生在 Layer 3；全局字段名 `evidence_strength` 一律改为 `source_strength`。

## 五、环境与路径（ADR-0005 已执行 · 路径已复查）

**当前实际位置：`/Users/jeremythierrychan/玄学与神秘学学习游戏`**

| 项 | 复查结果 |
|---|---|
| 副本数 | **1**（Spotlight 全盘只找到这一份，无 iCloud 残留副本） |
| 是否在 iCloud Drive 内 | **否**。`~/Library/Mobile Documents/com~apple~CloudDocs/` 下**没有**本项目路径 |
| `.icloud` 驱逐占位文件 | **0 个** |
| 第三方同步（坚果云 / Dropbox / Synology 等） | **无**（`~/Library/CloudStorage/` 为空；已注册 FileProvider 仅 iCloud / Photos / WeChat） |
| 所在卷 | `/System/Volumes/Data`（本地盘），非同步卷 |

> ✅ **结论：本项目已不在 iCloud 内，原 §五 的风险不再适用。** ADR-0005「代码仓库位置」由此**已执行完毕**——`git` 仓库与 `node_modules` 可以直接建在本目录内，不再需要把代码放到 `~/Projects/...` 之类的旁路目录。
>
> ⚠️ **一处残留（仅影响外观，不影响构建）：** 本目录仍带一个从 iCloud 时期留下的扩展属性 `com.apple.fileprovider.pinned#PX`（与 `~/Desktop`、`~/Documents` 的 `com.apple.file-provider-domain-id` 不同，本目录**没有** domain-id，说明它已不属于任何同步域）。如需清掉：`xattr -d com.apple.fileprovider.pinned#PX ~/玄学与神秘学学习游戏`。**不清也没有后果。**

**仍然成立的通用注意（与位置无关）：**

- 文档与代码同仓时，`packages/**/node_modules`、`.next`、构建产物必须在 `.gitignore` 内——否则 `git status` 与 CI 会被几十万文件拖死。
- 本目录文件名含中文。**任何工具链脚本、CI 配置、Docker 挂载路径都要用引号包裹**（`"$PWD"`），不要依赖空格/非 ASCII 安全。
- 若将来仍希望把代码与文档分离，ADR-0005 的结论可复活；但**当前没有必要**。

## 五之二、代码结构（同仓 monorepo，ADR-0008 step 1 已完成）

```
玄学与神秘学学习游戏/            ← git 仓库根（首次 git init 于 step 1）
├── README.md                   ← 本文件：索引 / 阶段路线 / ADR / 未决问题
├── docs/                       ← 项目长期记忆（设计文档）
├── pnpm-workspace.yaml         ← workspace 定义 + allowBuilds（pnpm 10+ 已迁至此）
├── tsconfig.base.json
├── packages/
│   └── domain/                 ← @dlg/domain：知识架构的类型与 schema
│       ├── SPIKE-REPORT.md     ← step 1 完成报告（先看这个）
│       ├── src/layer0/         ← provenance（sources / source_strength / review_status）
│       ├── src/layer1/         ← formalism · symbol · system · concept · relation · rule · transfer
│       ├── src/layer2/         ← skill（kind + judging_mode，**不含 Rubric 指针**）
│       ├── src/layer3/         ← rubric · assessment（AssessmentSpec）
│       ├── src/derive.ts       ← 派生视图 same_formalism_projection（机制 A）
│       ├── src/judges.ts       ← RuleJudge / RubricJudge / RuleTestSetRunner 接口
│       ├── src/validate/       ← 9 条 CI 规则 + 禁用语检查
│       ├── src/liuyao/         ← 规则引擎 spike（⚠️ 表格为未审核 draft）
│       ├── src/cli/            ← validate · spike 两个 CLI
│       └── test/               ← 68 条测试
└── apps/                       ← （尚未创建：step 3 的试玩页 / 内容流水线工具）
```

**命令：**

```bash
pnpm install
pnpm typecheck                                  # tsc --noEmit
pnpm test                                       # 68 条测试
pnpm validate                                   # CI 校验（空集合）
pnpm --filter @dlg/domain validate <bundle>      # CI 校验（真实内容 → step 2）
pnpm spike                                      # 规则引擎 spike 报告
```

> **为什么先建 `packages/domain` 而不是 UI：** UI 是数据模型的派生物；内容的体量不是瓶颈，内容的**格式**才是。第一个要写的 UI 其实是**内容流水线工具**（录入 / 审核 / 试玩预览），它同时是内容产线与技术风险集中点。

## 六、当前未决问题

> **ADR-0005 已执行**（§五 路径复查）；**ADR-0009–0015 已定案**（§四）；**ADR-0008 step 1 已完成**。

**阻塞项：无。** 下一步是 step 2（手写一条真实内容穿过 schema）。

**待确认 / 待复核：**

1. **CI 规则 R1 的拆法**（step 1 实现时的一处细化）—— V0.2.1 §4 写的是「`sources[]` 为空 → 构建失败」，但按字面执行会导致 `draft` 阶段无法存在（流水线第一步即死）。实现拆成 R1a（reviewed 无来源 → error）/ R1b（ai-candidate 处于 reviewed → error）/ R1c（draft 无来源 → warning）。**详见 `packages/domain/SPIKE-REPORT.md` §5，需你确认。**
2. **八宫卦序表需人工复核** —— `packages/domain/src/liuyao/tables.ts` 是 AI 起草的 `draft` 候选（3 项待核事项见 `SPIKE-REPORT.md` §6）。**未经复核不得进入 reviewed，不得用于教学或判分。**
3. **R1 证据清单需人工复核** —— 状态 `draft`，**升 `reviewed` 前不得作为事实写入内容库**。R1 自身声明：多数原文未逐字核对，标「中／低」置信度者需在原典或纸本书复核。
4. **H3 / H4 未验证** —— H3（同源投影降低学习成本）、H4（AI 能稳定执行 Rubric 判分）都要等 step 3–4 才有数据。
5. **`RuleTestSet` 的覆盖面** —— M6 已定其为六爻/占星进产品的前置条件，但由谁写、写到什么覆盖率，V0.9 再定。

> 已定案、不再重新讨论：ADR-0006（流派策略）、ADR-0007（类比准入）、ADR-0009（`Formalism` 判据与清单）、ADR-0010（`AttributeSpace`）、ADR-0011（`transfer_type` 枚举）、ADR-0012（`School` 锚点）、ADR-0013（B0 材料）、ADR-0014（MVP 跨体系节点 = B）、ADR-0015（低影响批量项）。


---

## 七、交接说明（新会话如何接上）

> 本项目的**长期记忆是 `docs/` 下的文档 + `packages/domain` 的代码与测试，不是对话记录**。所有结论、证据、置信度、待决策都已落盘，因此换目录、换会话、换 AI 都能无损接续。

### 新会话的启动读取顺序

| 顺序 | 文件 | 读它是为了拿到 |
|---|---|---|
| 1 | `README.md` | 定位、阶段路线、ADR 决策记录、开发步骤进度、当前未决问题（本文件） |
| 2 | `docs/V0-术语与边界.md` | 术语唯一定义、8 条认识论原则、非目标清单、伦理边界 |
| 3 | `docs/V0.1-知识架构.md` | 四层图模型、迁移类型学与三档准入、Mastery、Rubric、AI/规则分工、9 条 CI 规则 |
| 4 | `docs/V0.2-技能树与压力测试.md` | 塔罗/六爻技能树、**18 项模型修订（M1–M18）**、§8（已定案） |
| 5 | `docs/V0.2.1-架构决定清单.md` | M1 的 4 处未闭合（M12–M15）+ M16–M18、**已定案**的 ADR-0009–0015、修订版 schema、CI 规则 |
| 6 | `docs/research/R1-跨体系对应事实核查.md` | 跨体系对应的证据与置信度（**`draft`**，含 10 项「无法核实」清单） |
| 7 | `packages/domain/SPIKE-REPORT.md` | **step 1 完成报告**：ADR→代码映射、spike 抓到的接口缺陷、未审核数据警示、step 2 输入 |

### 接上之后的第一件事

**ADR-0008 step 1 已完成**（`packages/domain`，68 测全过，见 `SPIKE-REPORT.md`）。**下一步是 step 2：手写一条真实内容穿过 schema。**

step 2 的入口路径已打通：

```bash
pnpm --filter @dlg/domain validate <bundle.json>   # 通过即入库；失败会指出触发了哪条规则、依据是什么
```

**step 2 第一条内容的建议：B0 的一个 A 类样本**（ADR-0013：流派无关的符号层操作，如阴阳爻、五行生克的方向）。理由三条：

1. 它是阶段 0 的入口、跨体系共享 —— **写一次，四个体系复用**，能验证「共享单元」这个设计是否真的成立
2. 它不含任何流派分歧 → 不会被 M11（`anchor_sources`）与 M18（A/B 类样本）的审核门槛卡住
3. 它最小 —— step 2 的目的是验证**格式**，不是产出内容量

**注意：** 若在 step 2 过程中发现 schema 需要改，**先改 ADR 再改 schema**。`symbol_id`（共享还是新建）、五行是属性还是符号、`transfer_type` 取值域这三处变动 = 重写全部内容条目（这正是 step 1 必须先做完的原因）。

### 注意事项

- **ADR-0005–0015 均已决策/执行，不要重新讨论**。
- **不要重新生成术数理论**：凡涉及具体对应关系，引用 R1 或新增带来源的核查，并走同一条 `draft → reviewed` 流水线。`packages/domain/src/liuyao/tables.ts` 就是这条规则的活样本 —— 它是 AI 起草的 `draft`，代码里显式标注了未复核，测试断言它永远不是 `reviewed`。
- **R1 的方法学限制**：环境无直连网络，多数原文未逐字核对，标注为「中／低」置信度的条目需在原典或纸本书复核。
- **改动 schema 门槛已抬高**：见上。
- **代码与文档同仓**：`docs/` 是长期记忆，`packages/domain` 是决策的可执行形式。改动 schema 时**两处都要改**，否则文档与代码会互相说谎 —— 而 step 1 里 `palace_element` 那个缺陷正是「类型标注说谎」造成的。

