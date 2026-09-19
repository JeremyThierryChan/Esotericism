# step 3 · 预览站与 GitHub Pages 部署

> 状态：**✅ 已部署上线** —— https://jeremythierrychan.github.io/Esotericism/
> 对应代码：`apps/preview`（纯静态）｜`packages/domain/src/layer4`（Attempt/Evidence）｜`packages/domain/src/judges.ts`

---

## 零、部署结果（2026-09-19）

| 项 | 结果 |
|---|---|
| 站点地址 | **https://jeremythierrychan.github.io/Esotericism/** |
| GitHub Actions run | **#3 全绿**（build 12 步 + deploy 2 步，全部 success） |
| 站点资源实测 | `/` 200 · `index.html` 200 · JS 147KB 200 · CSS 3.9KB 200 · `.nojekyll` 200 |
| 打包产物内容核对 | JS 内含内容库（`木生火`）、规则 id（`rule.wuxing.shengke`）、`offline-skeleton`、`historicity` |
| `noindex` | ✅ 已生效（`noindex, nofollow, noarchive`） |
| 仓库可见性 | **公开**（按你的确认执行，见 §二 的合规说明） |

**部署过程共修 2 个 CI bug，见 §四。**

---

## 一、先说最重要的一件事：Pages 能做什么、不能做什么

你要给合伙人看的东西，**有一部分 GitHub Pages 从原理上就承载不了**。这不是配置问题，是架构事实。

| 能力 | GitHub Pages（纯静态） | 私有部署（有服务端） |
|---|---|---|
| 规则判分（六爻/五行这类**有唯一答案**的题） | ✅ **真跑** —— 规则引擎是纯 TS，在浏览器里执行 | ✅ |
| AI 按 Rubric 判分（塔罗这类**无唯一答案**的题） | ❌ **做不了** | ✅ |
| API key 安全保存 | ❌ **无处可放** | ✅ 留在服务端 |
| 落库 + 三道闸门审计（`Attempt` / `Evidence` / `JudgeAudit`） | ❌ 无数据库 | ✅ |
| 内容溯源面板（来源/强度/审核状态） | ✅ | ✅ |

**为什么 AI 判分在 Pages 上做不了：** 静态站没有服务端，key 只能放在网页里。**任何人查看源码就能拿走你的 key**，然后拿你的额度去跑自己的东西。这不是"风险较高"，是"必然泄露"。

所以本项目的部署分两级：

```
GitHub Pages   →  内部预览：内容 + 格式 + 规则判分闭环 + 溯源面板   ← 给合伙人看
私有部署       →  完整闭环：AI 判分 + 落库审计                      ← 验证 H4
```

**Pages 版绝不能用来验证 H4**（「AI 能稳定执行 Rubric 判分」）—— 它没有 AI 判分。H4 需要人工标注 50 条开放答案做一致性检验，那是私有部署的事。

---

## 二、⚠️ 合规问题：仓库可见性决定了这是不是"公开上线"

这是**需要你拍定**的一点，不能由我替你决定。

产品铁律里有两条规定与此直接冲突：

- **认识论原则 3**：只有 `reviewed` 可上线。而当前内容库**全部是 `draft`**（唯一来源 R1 自身也是 `draft`）。
- **V0.1 §13 / ADR-0008**：**早期部署到私有 URL，公开上线则要晚。**

GitHub Pages 的实际情况：

| 方案 | 内容是否公开 | 代价 |
|---|---|---|
| **公开仓库 + Pages** | **公开且可被搜索引擎收录**（我们加了 `noindex`，但那只是"请勿收录"，不是访问控制） | 免费。但等于**事实上的公开上线**：任何人可读、可克隆、可引用。与「公开上线则要晚」直接冲突 |
| **私有仓库 + Pages** | **不公开索引**，但拿到 URL 的人都能看 | 需要 GitHub Pro / Team（私有仓库的 Pages 是付费功能）。合伙人需**自行保密链接** |
| **不部署，本地给合伙人看** | 不公开 | 零风险，但合伙人要到你机器上看，或你截图 |

**我已做的降低风险措施：**

1. `<meta name="robots" content="noindex, nofollow, noarchive">` —— 请搜索引擎不要收录
2. `<meta name="referrer" content="no-referrer">` —— 不外泄来源页
3. 页面**顶部常驻横幅**，写明「内部预览 · 内容未经人工复核 · 不是产品 · 不构成任何预测或建议」
4. **溯源面板**把每条内容的来源强度与 `draft` 状态直接摊在页面上 —— 看的人一眼就知道这是草稿，不会误当成已核实的术数结论

**我的建议：私有仓库 + Pages。** 理由：①合伙人看得到 ②不产生公开可检索的术数内容 ③`draft` 内容不进入搜索引擎索引，避免"把未经核实的术数结论公开传播"这一伦理风险。费用是你那边的事，需要你确认。

> **注意：即使选了私有仓库，URL 一旦流出就不再可控。** 如果内容是"给合伙人看"而不是"给任何人看"，这个方案成立；若要更强控制，只能走"本地演示"。

---

## 三、站点里有什么（合伙人会看到的）

| 区块 | 内容 | 为什么放它 |
|---|---|---|
| 01 内容库状态 | 12 类实体计数 + CI 校验结果（error/warning 数） | 让人一眼看到"有 CI 门，不是随手堆内容" |
| 02 规则判分题 | 五行生克关系判断题，**可提交、可判对错** | 这是**真功能**，不是截图。规则引擎在浏览器里跑，真值表来自内容库 |
| 03 开放题 | 塔罗↔占星性质说明；提交后得到**确定性机械检查 + Rubric 逐条自查清单** | 诚实展示局限：明确标注「离线骨架，未做判断」 |
| 04 跨体系节点 | 塔罗↔占星类型 3 边、`historicity = 重建`、四段式、文献链 | 这是产品的差异化定位：**说清对应是怎么被建构出来的** |
| 05 溯源面板 | 每条内容的来源强度 / 审核状态 / 争议标记 / 来源 | "来源可见"比"内容更多"更重要 —— 这是与通俗术数教学的分界线 |

**页面上没有任何硬编码的术数内容**，全部从 `packages/content/bundle.json` 读。理由与规则引擎相同：理论只存在于内容库，而内容库每一条都带来源与审核状态，能被 CI 拦。

---

## 四、部署现状与你还需做的两步

**已完成（2026-09-19）：**

| 项 | 结果 |
|---|---|
| 远端仓库 | `https://github.com/JeremyThierryChan/Esotericism`（**公开**，已按你的确认执行） |
| 分支 | 本地 `master` → `main`，与远端默认分支一致 |
| 推送 | 已推送，本地与远端 HEAD 一致（`21bac66`） |
| 公开前页 | README 已加：未复核声明 / 这是什么 / 当前状态 / 快速上手 / 关键设计 / 许可 |
| 敏感信息扫描 | 无密钥、无 `.env`、无 `.DS_Store` 被跟踪 |
| 带真实 `BASE_PATH` 的构建 | ✅ `/Esotericism/` 子路径正确（大小写与仓库名一致） |

### 部署实测记录（两次运行，逐步骤结果）

| 步骤 | #1 | #2 | #3 | 说明 |
|---|---|---|---|---|
| checkout | ✓ | ✓ | ✓ | |
| **pnpm/action-setup** | **✗** | ✓ | ✓ | #1 死在「重复指定 pnpm 版本」 |
| setup-node / Install | skip | ✓ | ✓ | `--frozen-lockfile` |
| **Typecheck** | skip | **✓** | **✓** | 三个包 |
| **Test** | skip | **✓** | **✓** | 119 条，在 GitHub runner 上真实通过 |
| **Validate content library** | skip | **✓** | **✓** | 14 条 CI 规则 |
| **Build preview** | skip | **✓** | **✓** | 含产物冒烟测试 |
| Add .nojekyll | skip | ✓ | ✓ | |
| **configure-pages** | skip | **✗** | **✓** | #2 权限不足；Pages 开启后通过 |
| upload-pages-artifact | skip | skip | **✓** | |
| **deploy** | skip | skip | **✓** | 上线 |

> **注意 #3 是通过「等你开 Pages」+「重推一次」解决的，不是靠改代码。** #2 之后的失败原因是外部状态，不是配置错误。

**第一个 bug（已修）：** `pnpm/action-setup@v4` 在根 `package.json` 已有
`"packageManager": "pnpm@11.24.0"` 时**拒绝**再接收 `version` 输入
（`Multiple versions of pnpm specified`）。我两处都写了版本号 → 删掉 `version`，版本只在一处声明。

**第二个 bug（已修，且验证了这是外部状态而非配置错误）：** `configure-pages` 曾加
`enablement: true` 想让它自己开 Pages，但**「启用 Pages」是仓库设置操作，`GITHUB_TOKEN` 没有该权限**
→ `Resource not accessible by integration`。已删掉该参数；你在 Settings → Pages 手工开启一次后，
同一步骤即通过（#3 证实）。

### ✅ 已完成：Pages 已开启，部署成功

你已在 Settings → Pages 把 Source 设为 GitHub Actions；推送后 workflow 自动运行并成功。

**当前流水线行为：** 之后每次推送到 `main` 且改动命中 `apps/preview/**`、`packages/**`、`.github/workflows/pages.yml` 时自动重新部署。
**任何一步失败都不会发布** —— 旧版本继续在线。

### 原来的手动方式（备查）

**① 建仓库并推送**

```bash
cd ~/玄学与神秘学学习游戏

# 私有仓库（推荐）
gh repo create <repo-name> --private --source=. --remote=origin --push
# 或手动：
# git remote add origin git@github.com:<你>/<repo-name>.git
# git push -u origin master
```

**② 打开 Pages**

仓库 → Settings → Pages → Source 选 **GitHub Actions**。之后每次 push 到默认分支，`.github/workflows/pages.yml` 会自动：

```
typecheck → test（119 条）→ 内容库 CI 校验 → 构建预览站 → 冒烟测试 → 发布 Pages
```

**任何一步失败都不会发布。** 这是我刻意设的门：内容不合格或测试挂了，旧版本继续在线，不会把坏版本推给合伙人。

站点地址：`https://<user>.github.io/<repo-name>/`

**本地先看一眼：**

```bash
pnpm --filter @dlg/preview dev      # 开发服务器
pnpm --filter @dlg/preview build    # 构建 + 冒烟测试（产物在 apps/preview/dist）
BASE_PATH=/<repo-name>/ pnpm --filter @dlg/preview build   # 模拟 Pages 子路径
```

---

## 五、预览站的技术选型（ADR-0018）与边界

**用 Vite 纯静态，不用 Next.js** —— 这与 ADR-0001（Next.js 单体全栈）不冲突，因为：

- ADR-0001 定的是**最终产品**的技术栈（需要 SSR、API 路由、DB）——**V1.0 学习者端仍按 ADR-0001 用 Next.js**
- 本站是**预览**：无服务端、无路由、无数据库，只有一页。引入 Next.js 只会带来一堆用不上的服务端假设
- 零新增框架依赖：Vite 本来就在依赖树里（vitest 的同伴），构建 300ms 出 148KB 产物

**边界（不要越界）：** 预览站**不是**学习者端 UI，也不承担 V0.4/V0.5/V1.0 的任何职责。它存在的唯一目的是"让内容与判分闭环可以被看见"。

---

## 六、这一轮补的 schema（Layer 4）

step 3 的验收标准是「提交真实答案 → 六段式反馈且**过程可审计**」，而 `Attempt`/`Evidence` 原本排在 V0.6（step 5 之后）——**与 step 2 必须先补 `Exercise` 是同一类顺序漏洞**：验收标准里的动词（"落库"、"可审计"）没有对应的落库对象。

新增（`packages/domain/src/layer4/user-state.ts`）：

| 实体 | 作用 |
|---|---|
| `Attempt` | 一次作答：答案 + 过程文本 + 判分记录 |
| `JudgingRecord` | 判分结果 + `decided_by`（规则 / AI / 离线骨架）+ `audit` |
| `JudgeAudit` | **三道闸门的落库形式** |
| `Evidence` | 由 Attempt 抽出的观测；掌握度**只由 Evidence 更新** |

**三道闸门在代码里是这样落实的：**

| 闸门 | 落实方式 | 测试 |
|---|---|---|
| ① 知识边界 | `JudgeAudit.knowledge_scope_ids` 记录本次判分注入了哪些条目；提示词要求 AI 只依据给定条目，并明确「不得引入任何未给出的术数对应关系」 | `judging.test.ts` 断言提示词含 Rubric 全文与条目 ID |
| ② 不得写入 | `JudgeAudit.wrote_to_library` 是 `z.literal(false)` —— **类型上就不可能为 true** | 每个判分器测试都断言它为 false |
| ③ 落库可审计 | `prompt_text` / `prompt_digest` / `model` / `raw_output` / `human_reviewed` / `runtime` 全部记录 | AI 判分输出无法解析时，审计仍然完整 |

**一处刻意的设计：** `runtime` 区分 `server` / `browser-byok` / `offline-skeleton`。因为浏览器自带 key 的审计强度天然更弱，不标注就会污染 H4 的评测集。

---

## 七、AI 判分与私有部署：已延后（ADR-0020）

**决定：现在不需要 AI 判分，先做别的。本页的「私有部署」随之取消 —— 它存在的唯一理由就是承载 AI 判分。**

### 代码已经在位，恢复时不需要重做

| 已完成 | 位置 |
|---|---|
| AI 按 Rubric 判分（严格 JSON + 六段反馈 + 三道闸门审计） | `packages/domain/src/judges.ts` 的 `createRubricJudge` |
| 提示词构造（注入 Rubric 全文 + 可引用条目 ID，闸门 ①） | `buildRubricPrompt` |
| 输出解析（容忍代码围栏、非法 verdict 规整为 uncertain） | `parseJudgeJson` |
| 19 条判分测试（含 violation 一律不通过、解析失败时审计仍完整） | `packages/content/test/judging.test.ts` |
| Layer 4 落库对象（`Attempt` / `Evidence` / `JudgeAudit`） | `packages/domain/src/layer4/user-state.ts` |

**LLM caller 是注入式的**（`LlmCaller` 接口），恢复时只需提供一个 caller —— 服务端调用、浏览器自带 key、或本地模型都行。

### 延后带来的三个后果（必须记录，不能只说「以后再说」）

1. **H4 无法验证。** H4（AI 能稳定执行 Rubric 判分）是 MVP 两条核心命题之一。延后意味着现在**只剩 H3（迁移是否降低学习成本）可验证**。
2. **ADR-0008 step 3 的验收标准失效。** 它写的是「提交真实答案 → 六段式反馈且过程可审计」，六段式反馈需要 AI。
3. **MVP 切片需要重新定义（ADR-0003）。** 原切片含「1 个开放题 + AI 反馈」，该项失效。同时产生一个战略推论：**判分能力决定内容重心** —— 现在唯一能闭环的是规则判分，因此优先扩**规则密集型**内容（六爻装卦纳甲六亲世应、五行生克冲合，也正是 V0.2 §5.6 说的"内容成本低、可自动生成题目"那一类）；**塔罗开放题暂时只能自评，不能进掌握度**。这与原定「塔罗为主」的方向相反，需重新拍定。

### 一个我建议不要走的替代路

可以把离线骨架的机械检查结果转成 `confidence: 'low'` 的证据，从而让开放题勉强进掌握度。**我倾向不做** —— 那是用机械检查冒充能力评估，会污染 V0.6 的掌握度模型。若你要求，改动很小，但代价是掌握度数据的可信度。

> 统一清单见 `README.md` §六之二（D1–D6 延后、T1–T5 待办）。
