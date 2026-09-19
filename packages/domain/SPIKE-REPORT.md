# step 1 · 规则引擎 spike 报告

> 状态：**已完成**（ADR-0008 step 1）
> 对应验收标准：`packages/domain` 类型 + zod schema + CI 校验规则，**缺来源 / 缺迁移类型的内容构建失败**
> 代码：`packages/domain/`｜测试：68 条全过｜typecheck：干净

---

## 一、结论

| 问题 | 结论 |
|---|---|
| `RuleJudge` / `RuleTestSet` 接口能不能同时容纳**纯算法**规则与**表驱动**规则 | ✅ **能**。L2.1（三爻→八卦，位组合算法）与 L6.1（定世应，八宫卦序查表 + 派生）在同一 `RuleTestSet` 契约下都跑通 |
| ADR-0009–0015 的决策能不能直接写进 schema | ✅ **能，但 spike 立刻抓到一个形状缺陷**（见 §四） |
| 9 条 CI 规则能不能真的拦住东西 | ✅ 每条规则都有对应测试，且**都能被触发**（否则规则就只是注释） |
| 只有塔罗（解释密集型）就以为不需要规则引擎，这个风险是否已排除 | ✅ 接口已定且被表驱动规则验证过。V0.2 §5.2 警告的那个坑没有踩 |

**V0.2 §6 的便宜保险兑现了：** 加测 L6.1（而不是只做 L2.1）在第一次运行就暴露出一个会被写进内容条目的接口缺陷。

---

## 二、ADR → 代码映射（决策有没有真的落地）

| ADR | 决策 | 代码位置 | 锁它的测试 |
|---|---|---|---|
| 0009 | `Formalism` 4 项清单；`Symbol.formalism_id`；共享只在同一 Formalism 内 | `src/layer1/formalism.ts`、`src/layer1/symbol.ts` | `schema.test.ts`（拒绝 `western-esoteric`）、`derive.test.ts` |
| 0010 | 废止 `Attribute` 实体 → `AttributeSpace` + `has_attribute`；五行取值是 `Symbol` | `src/layer1/symbol.ts`、`src/validate/rules.ts` R11 | `validate.test.ts`（R11 两条）、`schema.test.ts` |
| 0011 | `transfer_type ∈ {3,4,5}`；类型 1/2 降为派生视图 | `src/layer1/transfer.ts`、`src/derive.ts` | `schema.test.ts`（拒绝 1/2）、`derive.test.ts`、`validate.test.ts` R8 |
| 0012 | `School.anchor_sources[]`；年份可空；不得用当代流派名作锚 | `src/layer1/system.ts`、`src/layer0/provenance.ts` | `validate.test.ts`（R7）、`schema.test.ts`（无 year 合法） |
| 0013 | B0 样本分 A/B 类 | ⏳ Layer 3 课程层，step 2 才落 | 待 step 2 |
| 0014 | MVP 跨体系节点 = B（塔罗↔占星，类型 3 `重建`） | `src/layer1/transfer.ts`（重建类也要求反向练习） | `validate.test.ts`（R3 的 `重建` 用例） |
| 0015① | Schema 为 S1–S9 | `src/layer1/concept.ts` | `schema.test.ts` |
| 0015④ | `System` 不带 `family` | `src/layer1/system.ts` | `schema.test.ts`（`family` 不存在；七政四余可引用两个 Formalism） |
| 0015⑤ | 判分绑定移到 Layer 3（新增 `AssessmentSpec`），`Skill` 不含 Rubric 指针 | `src/layer2/skill.ts`、`src/layer3/assessment.ts` | `schema.test.ts`（无 `rubric_id`）、`validate.test.ts`（R5/R6 + 同一 Skill 双规约） |
| 0015⑥ | `EvidenceStrength` → `SourceStrength` | `src/layer0/provenance.ts` | `schema.test.ts` |
| M4 | `Rule` 与判分器接口现在定义，即使 MVP 用不到 | `src/layer1/rule.ts`、`src/judges.ts` | `liuyao.test.ts`、`spike` CLI |
| M6 | `RuleTestSet` | `src/layer1/rule.ts`、`src/judges.ts#createRuleTestSetRunner` | `spike` CLI（8/8 + 10/10） |

---

## 三、验收命令

```bash
pnpm install
pnpm typecheck                 # tsc --noEmit，干净
pnpm test                      # 68 条测试全过
pnpm validate                  # CI 校验（空集合）
pnpm --filter @dlg/domain validate <bundle.json>   # CI 校验（真实内容，step 2）
pnpm spike                     # 规则引擎 spike 报告
```

`validate` 的退出码：`0` 通过 / `1` 构建失败（有 error 级问题）——可直接接 CI。

---

## 四、spike 抓到的问题（这是本报告最值得看的一节）

### 缺陷：`palace_element` 字段名与内容不符

第一版 `resolveHexagram()` 返回：

```ts
palace_element: PalaceEntry   // ← 名字说"五行"，实际装的是八宫表的一整行
```

而 `resolveShiYing()` 里写的是 `hex.palace_element.element` —— 但 `PalaceEntry` 上**没有** `element` 字段，于是运行时静默得到 `undefined`，类型系统因为类型标注说谎而没拦住。

**为什么这个缺陷值得单独记录：**

1. 它是**表驱动规则**独有的失败形态（纯算法的 L2.1 不会暴露它）。**如果只按原计划做 L2.1，这个字段会带着错误语义进入 step 2 的内容条目**，之后修正 = 重写全部世应相关条目。
2. 它证明了 V0.2 §6 那句「一天的成本，避免『塔罗做完了才发现规则引擎接口设计不下去』」是**具体成立**的，不是修辞。
3. 修正方式：拆成三个语义明确的字段 —— `palace_name`（宫名）、`palace_element`（宫五行）、`entry`（原始表行）。

### 修正后的形状

```ts
interface HexagramResult {
  name: string | undefined;          // 卦名
  palace_name: string | undefined;   // 「乾宫」
  palace_element: '金'|'水'|'木'|'火'|'土' | undefined;  // 宫五行
  entry: PalaceEntry | undefined;    // 八宫表原始条目（世爻位置、位次类型）
}
```

---

## 五、需要人类确认的一处细化（改动了 V0.2.1 的字面表述）

V0.2.1 §4 的 CI 规则 1 写的是「**`sources[]` 为空 → 构建失败**」。

但 V0.1 §14 的元数据注释写的是「空数组 = **禁止进入 `reviewed`**」，而流水线 ① 明确允许 AI/人工起草产出 `draft`。**按字面执行规则 1，草稿阶段根本无法存在，流水线第一步即死。**

因此实现拆成了三条：

| 编号 | 条件 | 级别 |
|---|---|---|
| **R1a** | `review_status === 'reviewed'` 且 `sources` 为空 | **error**（构建失败） |
| **R1b** | `authored_by === 'ai-candidate'` 且 `review_status === 'reviewed'` | **error**（认识论原则 3） |
| **R1c** | `review_status === 'draft'` 且 `sources` 为空 | **warning**（可存在，但不得升级为 reviewed） |

> **请确认这个拆法。** 我判断它才是流水线的实际意图（"无来源不入库"约束的是**上线**，不是**起草**），但它确实改动了 V0.2.1 的文字。若你要求字面执行，R1c 改为 error 即可（一行）。

**附带一处口径澄清：** `source_strength` 的取值域是**高/中/低**三档（V0 术语表 §4）；R1 报告里的「中–高」「低–中」是**文献置信度**的细分口径，只出现在 `SourceRef.confidence` 上，不进入 `source_strength`。

---

## 六、⚠️ 未审核数据警示：`src/liuyao/tables.ts`

**八宫卦序表是 AI 起草的 `draft` 候选，未经人工复核，不得进入 reviewed 内容库，不得用于教学或判分。**

这符合项目自身的铁律：
- 工作方式约定 5：AI 不生成未经人工审核的术数理论
- 认识论原则 3：无来源，不入库；AI 产出永远不能直接进入 `reviewed`
- R1 自身也是 `draft` —— **产品规则对自己的研究产出与对自己的代码同样生效**

代码里的三重标记：

```ts
export const REVIEW_STATUS = 'draft';   // 测试断言它永远不是 'reviewed'
export const DATA_PROVENANCE_NOTE = '...未经人工复核...';
// 表格不带 sources → CI 判定其不可升级为 reviewed（这是正确行为）
```

**待人工复核事项（3 项）：**

1. 八宫卦序（每宫八卦的次序）需与原典逐条核对。R1 Q3.2 只核实了《卜筮正宗》（清·王洪绪／王维德）、《增删卜易》（清·野鹤老人，李文辉编校刊行）、《易隐》（清·曹九锡）的**书名与作者归属**，**成书年份与具体世应表均未核实**。
2. 世爻位置的推导规则（本宫世六 / 一世世初 / … / 游魂世四 / 归魂世三）。
3. 应爻＝世爻隔三位的规则。

**spike 只验证接口形状，不验证术数正确性。** 当前测试断言的是**结构自洽**（64 条齐全、组合唯一、位次类型与世爻位置的对应一致），这些即使表内容有错也能过 —— 这是刻意的：正确性必须由人工核对原典来给，不能由 AI 自证。

---

## 七、step 2 的输入（已经就绪）

ADR-0008 step 2 = **手写一条真实内容穿过 schema**。入口路径已打通：

1. 写一份 `bundle.json`（可从一个最小真实内容开始：B0 的 A 类样本，或塔罗 T1.1 指认）
2. `pnpm --filter @dlg/domain validate <bundle.json>` → 通过即入库
3. 建议 step 2 的第一条内容选 **B0 的一个 A 类样本**（ADR-0013：流派无关的符号层操作），因为它是：
   - 阶段 0 的入口，跨体系共享，写一次四个体系复用
   - 不含任何流派分歧，因此不会被 M11/M18 的审核门槛卡住
   - 能同时验证「跨体系共享单元」这个设计是否成立

**按 V0.2.1 §4，step 1 schema 清单里的每一条都已落地**，除 `Course/Lesson/Exercise/Path`（V0.4）与 Layer 4 的 `Attempt/Evidence/Mastery`（V0.6）——那些不属于 step 1。
