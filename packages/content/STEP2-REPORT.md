# step 2 · 真实内容穿过 schema 报告

> 状态：**已完成**（ADR-0008 step 2）
> 对应验收标准：手写**一条真实内容**穿过 schema，**内容通过校验并入库**
> 代码：`packages/content/`｜测试：100 条全过（domain 82 + content 18）｜typecheck：干净

---

## 一、结论

| 问题 | 结论 |
|---|---|
| 真实内容能否穿过 schema 并通过 CI | ✅ 能。内容计数：formalism=4 symbols=7 symbol_usages=4 systems=2 schools=2 relations=10 rules=1 skills=2 rubrics=1 assessment_specs=2 **exercises=3** transfer_edges=1 |
| 「格式只能靠端到端打通一次来发现」是否成立 | ✅ **成立，而且发现了两处**（§四） |
| ADR-0009–0015 的模型能不能装下真实内容 | ✅ 能，且**机制 A 是自动推导出来的**（§三） |
| step 1 定的 CI 规则有没有死规则 | ❌ **有一条**：R3「反向练习」在 step 1 是死规则。已修（§四.1） |

---

## 二、补了 `Exercise`（ADR-0016）—— 因为 step 2 本来写不出东西

ADR-0008 **自己的验收标准与自己排的顺序打架**：

- V0.1 把 `Exercise` 放在 Layer 3，与 `Rubric` 同级
- ADR-0008 step 3 的验收标准是「**提交真实答案** → 六段式反馈且过程可审计」
- 但 `Exercise` 被排在 V0.5（练习题系统），而 V0.5 被排在 step 5 之后

后果在 step 2 就暴露了：**没有 `Exercise`，「一条真实内容」写不出可作答的题**，只能写教材知识点；而 step 2 的全部意义是打通格式，格式里最重要的那截（题目 + 判分绑定）恰恰卡着。

### 连带修掉一条死规则

`TransferEdge.paired_reverse_exercise_id` 是 **R3 强制**的字段，但它引用的是 `Exercise`。step 1 里 `Exercise` 不存在，于是：

- R3 只能检查「**有没有填**」，不能检查「**填的东西是否真实**」
- 填任意字符串都能过 → **一条永远无法真正满足、也无法真正违反的规则**

现在 R3 能做三件事：①没填 → 失败 ②填了但对象不存在 → 失败（"悬空的'反向练习'等于没有反向练习"）③对象存在但没指回本条边 → 失败（防止一条练习冒充多条边的反练习）。**双向确认。**

> 这是「格式只能靠端到端打通一次来发现」的第二个实证 —— 第一个是 step 1 的 `palace_element` 字段语义错误。

### ADR-0016 的边界声明

`Exercise` = **最小可玩单元**。它**不是** V0.5 的题型系统：不做难度曲线、不做自适应、不做 XP 挂点、不做变式生成。`Path` / `Unit` / `Lesson` 这些**编排**概念属 V0.4，本阶段一概不做 —— 一个 Exercise 不隶属于任何课程结构，它就是一道能答的题。

---

## 三、这条内容穿了什么（纵向双点切片）

### 点 1 · B0 · S4 五行生克的方向（ADR-0013 的 A 类样本：流派无关的符号层操作）

**为什么选它：**

1. 它让 **ADR-0010 那个修订第一次被实证**。M13 的原话是「『木生火』这条最基础的关系在 schema 里无处安放」—— 现在它安放了，而且 `related_by` 两端都是 `Symbol`：
   ```
   relation: { subtype: '生', from: sym.wuxing.木, to: sym.wuxing.火, direction: 'forward' }
   ```
2. 它是 **ADR-0013 的 A 类样本**：相生相克是闭循环结构，**流派无关**（不依赖任何一派的取法或权重），因此可以进 B0 而不违反 ADR-0006
3. 它**自动触发机制 A**：五行符号被**六爻**与**梅花**两个体系共用 → `sameFormalismProjection()` 算出 2 条投影，而且这些体系关系**没有**用任何 `transfers_as` 边表达

**实测输出（CLI）：**

```
派生视图 same_formalism_projection（机制 A，不落库）：2 条
  sym.wuxing.火（east-xiangshu）被 2 个体系使用：system.liuyao[六亲取用]、system.meihua[体用生克]
  sym.wuxing.木（east-xiangshu）被 2 个体系使用：system.liuyao[六亲取用]、system.meihua[体用生克]
```

**测试同时验证了两条闭循环**（不只是"数据在"）：相生 木→火→土→金→水→木 回到起点且五个都走到；相克 木→土→水→火→金→木 同理。

### 点 2 · 塔罗 ↔ 占星（类型 3，`historicity = 重建`；ADR-0014 的 MVP 跨体系节点）

**具体取「力量 ↔ 狮子座」这一对，因为它一次满足四个目的：**

1. 验证**类型 3 边**必须声明 `historicity`，且值是 `重建` 而非 `传播`
2. 验证 **ADR-0009 的核心判定**：两端分属 `tarot-symbolic` 与 `planetary-zodiac` **两个不同 Formalism** → 所以是**边**，不是共享符号。这正是 V0.2 §5.3 原文自相矛盾的那一处
3. 验证**四段式结构**（V0.1 §8.2）与第 ④ 段的**迁移练习**真实存在
4. **反向练习有了可查证史实做素材**：R1 Q1.6 记载 RWS 把力量（狮子座）置于 VIII、正义（天秤座）置于 XI，与 Golden Dawn 原序（VIII = 正义／天秤）**相反**，托特则沿用原序。反向练习题目就叫用户去查这个次序分歧，并回答「它支持还是削弱『塔罗与占星本相通』」。**不是编的教学例子。**

---

## 四、发现的两个问题

### 1. R3 在 step 1 是死规则 —— 已修

见 §二。

### 2. 「引用 R1 的内容条目无法升级为 reviewed」—— 这条连锁是正确的，但要说清

本 bundle **全部条目都是 `draft`**，且测试里有一条断言专门锁住这一点。原因是：

- 唯一来源是 **R1，而 R1 自己就是 `draft`**（README §六：升 `reviewed` 前不得作为事实写入内容库）
- 所以这些内容条目**当前不可能升级为 reviewed** —— 它们引用的是二手核查报告，不是一手文献

**要升级，路径只有一条：人工核一手文献。** R1 已经把该核的都列出来了（《张果星宗》ctext 原文、《增删卜易》成书年份、Book T 原条目等）。这不是缺陷，而是审核流水线在正确工作 —— **产品规则对自己的研究产出同样生效**。

> **顺带证明 ADR-0017（R1 三档拆分）是必需的：** 若按 V0.2.1 原文「`sources[]` 为空 → 构建失败」字面执行，`draft` 阶段根本无法存在；而这次的内容全部是 draft。若按另一种误读（"有 sources 就能 reviewed"），R1 的 draft 属性又会被绕过。三档拆分恰好把这两头都堵住。

### 3. 一个刻意的排除：八字没进内容

V0.1 §3 的标准例子是「六爻 / 梅花 / **八字**」三者共用五行。**本次只放了六爻与梅花，八字被排除** —— 因为：

- R1 Q3.2 核实了六爻的《增删卜易》《卜筮正宗》《易隐》书名与作者
- R1 Q4.1 核实了《梅花易数》的托名争议
- **R1 完全没有涉及八字的任何文献**

按认识论原则 3（无来源不入库），我不能给八字编一个 `anchor_sources` —— 而 ADR-0012 要求每个体系的 `default_school` 必须绑可引证文献（R7 强制）。**两个体系足够触发机制 A（`system_count = 2` ≥ 2）。** 八字等 R1 扩充或人工补核后再加。

**这是"AI 不生成未经人工审核的术数理论"这条规则在起作用，不是遗漏。**

---

## 五、⚠️ 未审核数据警示

**`packages/content/bundle.json` 的全部条目都是 `draft`，未经人工复核，不得上线。**

代码里的三重标记：

1. 每个条目的 `provenance.review_status` 都是 `'draft'`，`authored_by` 是 `'human'`（我起草 → 由人复核后才能改判）
2. `test/bundle.test.ts` 有断言：**全部条目必须处于 draft** —— 谁把某条改成 `reviewed` 而不核一手文献，测试就失败
3. 来源全部指向 R1（`draft`），因此 `source_strength` 最高只能填「中」

**待人工复核的具体事项（按重要性）：**

| # | 事项 | 对应 |
|---|---|---|
| 1 | 五行相生/相克的两条闭循环是否与原典一致（R1 Q2.2 引清華講義與 *De caelo*，未逐字核对原文） | 点 1 的全部 10 条 relation |
| 2 | 《增删卜易》的成书年份（R1 只核实了书名与作者，故 `year` 留空） | `school.liuyao.zengshanbu` |
| 3 | 《梅花易数》的成书年代与编者（R1 明示「说法互相矛盾，无定论」） | `school.meihua.tongxingben` |
| 4 | 力量＝狮子座的归赋是否确为 Golden Dawn 原条目（R1 Q1.6 标「未逐字核对条目原文」，置信度**中**） | `edge.tarot-astro.strength-leo` |
| 5 | 八宫卦序表（step 1 遗留，见 `packages/domain/SPIKE-REPORT.md` §6） | `packages/domain/src/liuyao/tables.ts` |

---

## 六、step 3 的输入（已就绪）

ADR-0008 step 3 = **试玩预览页 + AI 按 Rubric 判分闭环 + 落库 → 私有部署**。
验收标准：**提交真实答案 → 六段式反馈且过程可审计（验证 H4）**。

现在缺的只有运行时，schema 与内容都齐了：

| step 3 需要 | 现状 |
|---|---|
| 一道能答的题 | ✅ `exercises`（3 道：1 道规则判分 + 2 道 Rubric 判分） |
| 判分规约 | ✅ `rubrics`（含六段式 `feedback_template`） |
| 判分接口 | ✅ `RuleJudge` / `RubricJudge`（`packages/domain/src/judges.ts`） |
| 规则引擎 | ✅ `rule.wuxing.shengke` + `RuleTestSet`（7 条用例，测试里已被真值表复算） |
| 落库对象 | ⚠️ **缺 Layer 4**：`Attempt` / `Evidence`（V0.6）。step 3 要「落库」就必须补，规模比 Exercise 还小 |
| 试玩页 | ⚠️ 缺 `apps/web`（ADR-0001：Next.js）+ 私有部署 |
| AI 调用 | ⚠️ 缺 API key 配置与「三道闸门」落地（V0.1 §12：知识边界注入 / 不得写入 / 落库可审计） |

**建议 step 3 的第一步不是画页面，而是补 Layer 4 的 `Attempt` + 判分落库**，理由与 step 2 补 `Exercise` 相同：**「落库」是 step 3 验收标准里的动词，而落库对象不存在。** 先把审计链打通，页面才有东西可显示。
