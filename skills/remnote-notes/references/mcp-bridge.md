# RemNote MCP Bridge 直写参考

本参考适用于会话中存在 `remnote_*` MCP 工具（RemNote MCP Bridge cc52 fork）的场景。最后实机核验于 2026-07-13，对应插件 0.17.14 / server 0.17.1（21 个工具全量在线冒烟验证）。桥接能力随版本变化，`remnote_status` 报告的版本与本文不符时，以实际工具 schema 和回读结果为准。

## 目录

1. [交付模式判定](#1-交付模式判定)
2. [会话预检](#2-会话预检)
3. [内容语法：与粘贴模式的异同](#3-内容语法与粘贴模式的异同)
4. [写入工作流](#4-写入工作流)
5. [查重、精确引用与导航](#5-查重精确引用与导航)
6. [Hint、Extra 与事后制卡](#6-hintextra-与事后制卡)
7. [Alias、标签与 Portal](#7-alias标签与-portal)
8. [对比表格（Advanced Table）](#8-对比表格advanced-table)
9. [Rem 特性与学习组织](#9-rem-特性与学习组织)
10. [学习日志](#10-学习日志)
11. [回读验收](#11-回读验收)
12. [写入安全规则](#12-写入安全规则)
13. [已知问题](#13-已知问题)

## 1. 交付模式判定

- 会话中没有 `remnote_*` 工具 → 使用粘贴模式（[syntax-full.md](syntax-full.md)），本文不适用。
- 有 `remnote_*` 工具但 `remnote_status` 显示未连接 → 提示用户启动 companion 与插件，或降级为粘贴模式。
- 已连接 → 默认 MCP 直写；用户明确要求文本时仍输出可粘贴正文。

## 2. 会话预检

每会话一次：

1. `remnote_status`：确认 `connected: true`，记录 server/plugin 版本与 `acceptWriteOperations` / `acceptReplaceOperation` 两个写闸门。
2. 需要操作决策树时调用 `remnote_get_playbook`（含导航 preset、内容模式与写安全指引）。
3. 确认目标父节点：用 `remnote_search`（可用 `parentRemId` 限定子树）定位，或让用户给出目标 Rem ID；不要默认写入知识库根。

## 3. 内容语法：与粘贴模式的异同

`remnote_create_note` / `remnote_insert_children` 的 `content` 走 RemNote SDK 的 `createTreeWithMarkdown`，闪卡分隔符与粘贴一致：`::`、`:>`、`:<`、`:-`、`;;`、`;<`、`;;<`、`;-`、`>>`、`<<`、`<>`、`>-`、`>>>`、`>>1.`、`>>A)`、`{{Cloze}}`、`{({Cloze 提示})}`。层级用缩进表达，规则同 syntax-full.md。

与粘贴模式的差异：

| 能力 | 粘贴模式 | MCP 直写 |
|---|---|---|
| 精确 Rem 引用 | 禁用 `[[名称]]` | `[[id:<remId>]]` 可靠解析（title/content/journal/表格属性值通用） |
| Extra Card Detail | `#[[Extra Card Detail]]` | 内联 `/extra 内容` 子行（管道原生支持） |
| 普通卡 Hint | 仅导入后手动 | `remnote_update_note` 的 `frontCardHint`/`backCardHint` |
| 事后制卡 | 不可能 | `update_note.backText` 把既有 Rem 变正向卡（见第 6 节） |
| Alias / 标签 / Portal | 仅导入后手动 | `addAliases`/`removeAliases`、`update_tags`、`manage_portal` |
| 建卡时挂标签 / 设文档 | 不可能 | `create_note` 原生 `tagRemIds` + `asDocument` 参数 |
| 对比表格 | 不可能 | `create_table` + `create_table_row`（见第 8 节） |
| 代码块语言 / TODO / 引用块 | 仅导入后手动 | `set_rem_features`（见第 9 节） |
| 外部链接 Rem | 纯文本 URL | `create_link_rem`（见第 9 节） |
| LaTeX | `$...$` 前后需空格 | 同左；写入后回读确认仍为原生公式 token |
| 本地图片 | 不支持 | 仍不支持（仅 URL 图片 token） |

## 4. 写入工作流

标准顺序（对应 SKILL.md 第 9 步的 MCP 分支）：

1. **查重**：对每个候选 Concept 名执行 `remnote_search`；命中同名或近义 Rem 时，优先 `[[id:...]]` 引用或按 remId 原地更新，不重复创建。
2. **建树**：`remnote_create_note`（`title` + `content` + `parentId`）。文档级根节点加 `asDocument: true`；确定的标签在创建时用 `tagRemIds` 一并挂上（省一次 update_tags）。返回的 `remIds` 与 `titles` 按自上而下对应，保存备用。
3. **增量插入**：向已有结构补卡用 `remnote_insert_children`（`position: first|last|before|after`），不重建整树。
4. **增强**：按 remId 逐项施加 hint、alias、标签、表格、Rem 特性、来源链接（见第 6–9 节）。
5. **学习日志**（可选，见第 10 节）。
6. **回读验收**：见第 11 节。

## 5. 查重、精确引用与导航

- 引用本批次内的概念：先建被引用的 Concept，从返回 `remIds` 取 ID，再在后续 `content` 或 `update_note.title` 中写 `[[id:<remId>]]`。
- 引用知识库既有概念：`remnote_search` 拿 remId 后引用；用 `headline`（含类型分隔符的完整行）确认是目标 Concept 而非同名 Descriptor。
- **大范围检索用游标分页**：`search` / `search_by_tag` / `list_children` 返回 `hasMore` + `nextCursor`，续页时保持同一 `parentRemId`/参数；不要靠加大 `limit` 硬吃全量。
- **子树内检索**：`remnote_search` 传 `parentRemId` 把范围限定在某分支（如只在"机器学习"文档下查重），结果不含该 Rem 自身。
- **层级定位**：`ancestorDepth`（常用 5）让 search/read/list 结果附带自下而上的祖先链，判断同名 Rem 属于哪个章节时必用。
- **标签维度查重与复盘**：`remnote_search_by_tag`（精确 tagRemId）。默认 `resultMode: "context"` 返回归属文档；`"tagged"` 返回被直接打标的 Rem。审计"易错"标签下的全部卡片、检查某学科已有覆盖时用它。
- **图遍历**：structured 模式结果带 `inlineRefs`（行内引用的目标 remId），可顺藤摸瓜读相关概念。
- 更新已有知识优先按 remId 原地修改，保护引用、Portal 成员和复习历史。

## 6. Hint、Extra 与事后制卡

- **普通卡 Hint 一律走 `remnote_update_note`**：`frontCardHint` = 正向卡提示（UI 显示 `→`），`backCardHint` = 反向卡提示（UI 显示 `←`）。
- **不要在 `content` 里写内联 `/hint` 行**：见[已知问题](#13-已知问题)。
- Cloze 内联提示 `{({...})}` 管道原生支持，可直接写在 `content` 中。
- **Extra Card Detail** 用内联 `/extra 内容` 子行（缩进在卡片 Rem 下），管道转换为原生 Power-up；`#[[Extra Card Detail]]` 标签写法未在 MCP 管道验证，不要混用。Extra 是 RemNote Pro 功能，内容限非核心补充。
- **事后制卡（已实机验证）**：对任何既有普通 Rem 调 `update_note` 设 `backText`，即变为正向 Basic 卡（回读 `cardTypes: ["forward"]`），front 文本不动，LaTeX 保留，可同时设 `frontCardHint`。适用场景：先写参考笔记、复习后决定某行值得记忆时原地升级为卡，不重建不换 ID。`richText`/`richTextBack` token 数组另支持 text/rem/image(URL)/link/code token，用于需要精确引用或混合内容的正/背面。

## 7. Alias、标签与 Portal

- **Alias**（`update_note.addAliases` / `removeAliases`）：专业术语加标准英文 alias（如 `Hypothesis Function`），高频英文简称可作第二 alias。数学记号 / LaTeX 一律不进 alias（渲染不可靠）；符号放 `~常用记号 ;-` 或公式描述符。普通问句、章节标题、描述符不加 alias。
- **标签**（`remnote_update_tags`，精确 tag Rem ID）：核心 Concept 1–3 个高价值标签（学科/任务、算法类别、知识类型、易错状态）；先 `remnote_search` 标签名拿 remId，不存在时先创建标签 Rem 并记录 ID；不用标签复制父子层级信息。创建新笔记时确定的标签直接用 `create_note.tagRemIds`。
- **Portal**（`remnote_manage_portal`）：`create`/`add`/`remove`/`read`，按精确 remId 操作，不改变源 Rem 层级。跨章节复用概念时优先 Portal 或引用，不复制卡片。

## 8. 对比表格（Advanced Table）

**何时用**：材料含系统性多维对比（≥3 个同类概念 × ≥2 个稳定维度，如"排序算法 × 复杂度/稳定性/场景"、"监督 vs 无监督 × 数据/目标/算法"）。表格是**概览与检索层**，不是制卡层：不做"每个单元格一张卡"的网格式制卡，卡片只测有区分力或易混的单元格（规则见 card-quality.md）。

**工作流**：

1. `remnote_create_table`（`title` + `columns` + `parentRemId`）。逐列检查返回的 `typeApplied`：**只有 text 列可靠**；checkbox 等类型会静默降级为 text（`typeApplied: false`），布尔值用"是/否"文本表达。
2. **关键：返回值里 `tableRemId` 与 `tagRemId` 是两个不同的 Rem**。行挂 tag、属性列挂在 tag Rem 下——**后续 `read_table`、`set_property.tagRemId`、`search_by_tag` 全部用 `tagRemId`**；对 `tableRemId` 调 read_table 会报 "not a table"。
3. `remnote_create_table_row`（`tableRemId` + `title` + `values` 按 propertyId 键控）。值支持 `{kind:"text"}`（含 `[[id:<remId>]]` 引用与 LaTeX）与 `{kind:"rem_reference"}`。
4. **建行后必须 `read_table`（传 tagRemId）验收行数**：实测存在"建行带全量赋值时行 tag 偶发丢失"的竞态——行不见了但属性值都在，用 `remnote_update_tags` 把 tagRemId 补挂回去即完整恢复，无需重建。
5. 单格修改用 `remnote_set_property`（`remId` + `tagRemId` + `propertyRemId` + value）。

**设计规则**：行标题优先直接引用已建 Concept（`[[id:<remId>]]` 作 title）或用同名短语；表格与卡片来源同一批 Concept，不做两份事实源。已有表格先 `read_table` 看 schema 再补行，不重复建表。

## 9. Rem 特性与学习组织

**`remnote_set_rem_features`**（全部实机验证）：

- `codeLanguage`：代码行/代码块 Rem 设语言（如 `"python"`），获得语法高亮。编程课笔记里的代码片段建后统一设置。
- `todoStatus: "todo" | "finished" | "clear"`：把"待核实项""待补充概念"落成 RemNote 原生 TODO——SKILL.md 第 2 步的待核实清单在 MCP 模式下建为 todo Rem，用户复习时可直接勾掉。
- `isQuote`：原文引用块标记为 Quote，从视觉上区分"材料原文"与"改写内容"，配合来源忠实原则使用。
- `isListItem`、`templateRemId`（按精确 ID 套模板）：仅在用户明确要求时使用。

**`remnote_create_link_rem`**（`url` + `title` + `parentRemId`）：课程页、文档、视频等来源链接建为原生链接 Rem，放在笔记根的"来源"节点下。注意：create 响应里的 `title` 字段显示 URL 派生文本，**实际 Rem 标题是传入的自定义 title**（回读确认）；会自动挂知识库的"链接"标签。

**结构调整**：`remnote_move_note` 与 `remnote_set_document_status` 默认 `dryRun: true`——先跑 dryRun 给用户看变更预览，得到确认后再 `dryRun: false` 执行；用 `expectedOldParentRemId` / `expectedOldRemType` 防陈旧上下文。新建文档级笔记直接用 `create_note.asDocument`，不需要事后 set_document_status。

## 10. 学习日志

批次写入完成后，可用 `remnote_append_journal` 在今日 Daily Doc 追加一条学习记录（默认带时间戳），内容用 `[[id:<根remId>]]` 链接到本批次根节点，如：`完成「单变量线性回归」制卡：14 个 Concept / 31 个复习方向 [[id:xxx]]`。确定的日志标签用 `tagRemIds` 挂精确 ID。

默认询问一次用户是否需要；用户所在工作流有自己的学习记录体系（如 Obsidian 侧）时不要重复记录。

## 11. 回读验收

写入批次完成后：

1. `remnote_read_note`（或 `list_children`）抽样回读：每种卡型至少 1 张。`view: "full"` 会暴露 `cardTypes`、`cardDirection`、`frontCardHint`/`backCardHint`、`controlledFeatures`（quote/listItem 状态）、`tags`、`ancestors`——验收直接核对这些字段。
2. 含 LaTeX 的卡确认公式仍为原生数学 token，未退化为普通字符串。
3. 加过 alias 的 Rem 确认主名称、alias、引用目标同指一个 remId。
4. 建过表格的批次：`read_table`（tagRemId）核对行数与属性值（见第 8 节竞态）。
5. API 回读通过后仍提示用户在 RemNote UI 抽样确认（尤其 hint 箭头方向）；API 与 UI 冲突时以 UI 为准并按桥接映射问题上报。
6. 汇报时区分"API 已验证"与"UI 待用户确认"，不要声称 UI 已验证。

## 12. 写入安全规则

- `remnote_replace_children` 是破坏性操作（删除既有子 Rem ID），需要 `acceptReplaceOperation: true`，仅在用户明确要求重建子树时使用，且先 `read_note` 快照现状。
- `move_note` / `set_document_status` 保持 dryRun-first：预览 → 用户确认 → 执行。
- 批量写入前先在单个测试父节点下试写 1 个最小样例并回读，确认卡型正确后再写全量。
- 写入失败或结果异常时停止批次，报告已写入的 remIds，不要盲目重试造成重复。
- 未经用户确认不删除任何既有 Rem；桥接没有删除工具，误建内容需提示用户在 UI 中手动删除。

## 13. 已知问题

- **内联 `/hint` 槽位映射疑似错误（0.17.14）**：建树管道把 `/hint` 写入正面文本的 `card-hint-front`（= 反向卡提示槽），与已修复的 `frontCardHint` 路径不一致；修复并实机验证前，hint 一律用 `update_note` 参数。
- **`create_table_row` 行 tag 偶发丢失**（0.17.14 实测）：建行响应正常但行未出现在 read_table 里；属性值不丢，`update_tags` 补挂 tagRemId 即恢复。每批建行后必须 read_table 验收。
- **`create_table` 非 text 列静默降级**：按 `typeApplied` 判断，不要假设 checkbox/number/select 生效。
- **`create_link_rem` 响应 title 有误导**：响应显示 URL 派生文本，实际标题是传入值；以回读为准。
- alias 对原生公式渲染不可靠（上游限制）——"数学记号不进 alias"规则的依据。
- 本地媒体上传不在桥接范围；图片仅支持 URL token，仍按 syntax-full.md 输出"需手动插图"占位。
