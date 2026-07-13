# RemNote 文本导入与编辑器语法

本参考以 RemNote 官方 Help 为准，最后核验于 2026-07-12（对照官方文档镜像，抓取于 2026-07-06；文本导入页更新于 2025-08-11）。优先保证“复制文本后被正确识别”，不要把编辑器快捷命令、其他笔记软件语法或旧教程写法当成文本导入语法。

## 目录

1. [适用范围](#1-适用范围)
2. [层级与 Markdown 导入](#2-层级与-markdown-导入)
3. [可靠的文本导入分隔符](#3-可靠的文本导入分隔符)
4. [Set、List 与选择题](#4-setlist-与选择题)
5. [Cloze 与提示](#5-cloze-与提示)
6. [Extra Card Detail](#6-extra-card-detail)
7. [Concept 与 Descriptor](#7-concept-与-descriptor)
8. [Reference、Tag 与 Portal](#8-referencetag-与-portal)
9. [Universal Descriptor](#9-universal-descriptor)
10. [公式、代码与图片](#10-公式代码与图片)
11. [安全示例](#11-安全示例)
12. [人工检查表](#12-人工检查表)
13. [官方来源](#13-官方来源)

## 1. 适用范围

以下“导入语法”适用于：

- 把多行文本直接粘贴进 RemNote；
- 通过 RemNote 的文本或 Markdown 导入功能导入正确格式的内容。

以下“编辑器命令”只表示在 RemNote 编辑器中键入后触发交互操作。除非官方文本导入页明确说明，否则不要承诺完整命令字符串会在粘贴时自动执行。

## 2. 层级与 Markdown 导入

- 每行可以有也可以没有 Markdown 行首 `-`；粘贴后会成为 bullet。
- 用行首空格表达父子层级。每层具体空格数不限，但同一级必须一致；本技能统一使用 4 个空格。
- Markdown 导入器把每个段落或列表项转换为一个 RemNote bullet。
- RemNote Markdown 导入使用 MarkedJS 默认方言，接近但不等同于 CommonMark。
- 避免在可粘贴正文中加入空白解释段、代码围栏或统计文字；它们也可能变成 Rem。

```text
主题
    子项一
    子项二
        孙项
```

## 3. 可靠的文本导入分隔符

### Basic

| 方向 | 分隔符 | 示例 |
|---|---|---|
| 正向 | `>>` 或 `==` | `问题 >> 答案` |
| 反向 | `<<` | `正面 << 背面` |
| 双向 | `<>` 或 `><` | `A <> B` |
| 禁用 | `>-` | `参考问题 >- 参考答案` |

### Concept

| 方向 | 分隔符 | 示例 |
|---|---|---|
| 正向 | `:>` | `概念 :> 定义` |
| 反向 | `:<` | `概念 :< 定义` |
| 双向 | `::` | `概念 :: 可唯一识别该概念的定义` |
| 禁用 | `:-` | `概念 :- 仅作笔记的定义` |

### Descriptor

Descriptor 必须缩进在它描述的 Concept 下。

| 方向 | 分隔符 | 示例 |
|---|---|---|
| 正向 | `;;` | `属性 ;; 值` |
| 反向 | `;<` | `属性 ;< 值` |
| 双向 | `;;<` | `属性 ;;< 值` |
| 禁用 | `;-` | `属性 ;- 仅作笔记的值` |

Descriptor 反向卡用“值 + Descriptor 上下文”询问父 Concept，不是询问 Descriptor 名称。只有答案能唯一识别 Concept 时才启用反向。

不要在文本导入中使用以下旧写法或编辑器快捷写法：

- Basic 禁用：`=-`
- Concept 禁用：`::-`
- Descriptor 双向：`;<>`

## 4. Set、List 与选择题

### Set：无序集合，一次显示

```text
需要完整回忆的三项 >>>
    项目 A
    项目 B
    项目 C
```

- 正向：`>>>`
- 反向：`<<<`
- 双向：`<><`

### List：顺序本身需要记忆，逐项测试

```text
必须按序执行的三步 >>1.
    第一步
    第二步
    第三步
```

- 正向：`>>1.`
- 反向：`<<1.`
- 双向：`<>1.`
- 禁用：`>-1.`

List 子项不要自带 `1.`、`2.` 等编号：官方明确说明导入后按文本顺序自动编号，手写编号会造成“1. 1. 第一步”式重复。

`>>>` 加编号子项在编辑器中可能被改成 List，但纯文本导入页为 List 明确规定的是 `>>1.`。生成可粘贴正文时始终使用 `>>1.`。

先判断是否真的需要回忆完整集合或顺序。长列表、证明和一般流程通常更适合拆成关键关系、选择点或难记转折。

### Multiple Choice

```text
题目 >>A)
    正确选项
    错误选项
    错误选项
```

- 文本导入时第一项固定为正确选项；复习时选项会打乱。
- 每个选项下再缩进一层的子 bullet 会在作答后显示，可放解析或纠错说明。
- 禁用选择题使用 `>-A)`。
- 只在用户要求模拟选择题或提供题库时使用，不用它替代开放回忆。

## 5. Cloze 与提示

### 文本导入支持

```text
二分查找要求输入序列已经{{有序}}
```

同一 bullet 中的多个 Cloze 在文本导入时各自独立成卡，不能在粘贴前合并：

```text
TCP 建立连接使用{{三次握手}}，释放连接通常使用{{四次挥手}}
```

上例产生 2 个独立 Cloze 遮挡。

文本导入明确支持 Cloze 内联提示：

```text
光合作用的光反应发生在{{类囊体膜}}{({叶绿体内的膜结构})}
```

提示的作用是澄清题意，不是降低难度：可以限定问域（“与惯性有关的那条定律”）或提供不含答案的助记、个人联想线索；不得直接给出答案、同义改写、首字母或字数。官方提醒：若提示逐渐变成变相给答案，应重写卡片而非保留提示。

### 仅作导入后操作

普通 Basic、Concept、Descriptor 或 Multi-line 卡的 `/hint` 是编辑器命令。不要把 `/hint 提示内容` 放进声称可直接粘贴的正文；改在“导入后操作”中列出目标卡和建议提示。

## 6. Extra Card Detail

Extra Card Detail 是 RemNote Pro 功能。文本导入页明确支持在相应子 bullet 上写入 Power-up tag：

```text
什么是过拟合？ >> 模型拟合训练数据却不能泛化到未见数据
    常见表现：训练误差低、验证误差高 #[[Extra Card Detail]]
```

Extra Card Detail 只能放非核心补充、例子、误区或来源线索；必须测试的内容应放在答案或独立卡中。

`/extra` 与 `/ecd` 是编辑器命令。不要把它们作为文本粘贴容器输出。

## 7. Concept 与 Descriptor

- Concept 表示具体或抽象的“事物”；Descriptor 表示父 Concept 的属性或问题。
- Concept 的背面在复习子卡时隐藏，可减少祖先上下文泄露答案。
- Concept 不必总是双向。只有背面能唯一、稳定地识别名称且反向检索有用时使用 `::`。
- Descriptor 默认正向；反向 Descriptor 测试父 Concept，因此更容易出现歧义。

官方文本导入页的 Concept/Descriptor 高级 Multi-line、List 和 Multiple-Choice 分隔符表，与同页“Concept 以冒号开头”的规则及编辑器三连触发说明存在矛盾。不要依赖这些高级组合。使用可靠替代结构：

```text
核心方法 :> 方法的简洁定义
    关键步骤 >>1.
        第一步
        第二步
        第三步
```

## 8. Reference、Tag 与 Portal

### Reference

官方 Help 保证的是：在编辑器中键入 `[[`、`++` 或 `@`，搜索并选择目标 Rem。官方文本导入页没有保证粘贴完整 `[[名称]]` 会解析为既有 Rem，也无法用纯文本消歧同名 Rem。

默认在正文中保留普通文本，并在“导入后操作”中列出建议 Reference：

```text
建议连接：在“光合作用”的阶段属性中，把“光反应”和“卡尔文循环”转为 Reference。
```

不要声称普通 `[[名称]]` 已建立双向链接。

### Tag

官方 Help 保证的是：在编辑器中键入 `##`，搜索或创建 Tag。不要把普通 `#标签` 当成可靠的 RemNote 文本导入标签语法。`#[[Extra Card Detail]]` 是官方明确列出的特殊导入例外，不能泛化到任意 Power-up。

### Portal

Portal 需要在编辑器中键入 `((` 后搜索目标，或通过粘贴 Rem 引用再转换。没有通用的纯文本 Portal 导入语法。

禁止使用 `{{[[概念]]}}` 表示 Portal；它可能被解释为 Cloze 文本。

## 9. Universal Descriptor

Universal Descriptor 不是因为文字以 `~` 开头就获得特殊语义。它本质上是知识库中的一个 Rem，通常集中放在 `~` 下；使用时要创建对该 Rem 的 Reference。它也可以被设置为 Property，在被引用时自动产卡。

因此：

- `~作用 ;; 某内容` 只是名字以 `~` 开头的普通 Descriptor；
- 只有用户确认知识库已有对应 Universal Descriptor Rem 或 Property 时，才在导入后建议把普通 Descriptor 转成该 Rem 的 Reference；
- 默认生成“作用”“适用条件”“主要区别”等普通 Descriptor 名称，保证粘贴行为可靠。

导入后可向用户建议：导入官方 Universal Descriptor 推荐清单（会置于知识库的 `~` Rem 下），并启用官方 “Universal Descriptors Quick-Input” 插件以便用 `~` 快速插入引用。

## 10. 公式、代码与图片

### 公式

RemNote 可把粘贴文本中的单美元符号公式转换为行内公式，把双美元符号公式转换为块级公式：

```text
行内公式前后留空格：函数值为 $f(x)=x^2$ 。
块级公式：$$E=mc^2$$
```

单美元符号的前后必须各有至少一个空格，否则不会被识别。行末公式优先改用 `$$...$$`、在末尾保留空格，或使用普通文本表达。还支持 `\[ ... \]` 块级形式。

### 代码

RemNote 的代码块是独立 bullet，不能与卡片箭头位于同一 bullet。官方文本导入页没有承诺粘贴任意 Markdown 围栏即可得到所需卡片结构。需要代码卡时，优先：

- 把代码作为祖先上下文，子级用 Basic 卡提问；或
- 导入后在 Multi-line 卡背面手动创建代码块。

### 图片

普通文本 `[图片：文件名]` 只是占位符，不会导入图片。Markdown 导入器支持公开 URL，或 ZIP 内相对路径指向的图片。无法提供真实资源时，输出明确的人工占位：

```text
需手动插图：001-example.png
```

## 11. 安全示例

```text
排序算法
    稳定排序 :> 相等关键字元素在排序后仍保持原相对次序的排序
        判断标准 ;; 相等关键字元素的相对次序不变
    稳定性为什么重要？ >> 它能保留先前排序或原始顺序中仍有意义的信息
    常见稳定排序 >>>
        归并排序
        插入排序
    插入排序的核心过程 >>1.
        从未排序区取出一个元素
        在已排序区中找到插入位置
        移动元素并插入
```

该例只演示语法，不代表这些卡片适合任何具体材料；生成时仍须满足来源忠实和检索价值。

## 12. 人工检查表

- Set 使用 `>>>`，List 使用 `>>1.`。
- List 子项不自带编号，导入后由 RemNote 自动编号。
- Basic、Concept、Descriptor 的禁用符分别为 `>-`、`:-`、`;-`。
- Descriptor 双向使用 `;;<`。
- 每层缩进一致，子项确实位于父卡下。
- 多个 Cloze 按多个独立遮挡计数。
- 可粘贴正文中没有 `/hint`、`/extra`、`/ecd` 或伪 Portal。
- `[[名称]]` 没有被承诺为已解析 Reference。
- `~名称` 没有被承诺为已配置 Universal Descriptor。
- Extra Card Detail 使用 `#[[Extra Card Detail]]`，且已注明 Pro。
- 单美元符号公式前后有空格。
- 图片占位明确标注“需手动插图”。
- 粘贴后抽样预览各类卡的方向与答案。

## 13. 官方来源

- [How to Import Flashcards from Text](https://help.remnote.com/en/articles/9252072-how-to-import-flashcards-from-text)
- [Creating Flashcards](https://help.remnote.com/en/articles/6025481-creating-flashcards)
- [Multi-Line (List & Set) Flashcards](https://help.remnote.com/en/articles/9216774-multi-line-list-set-flashcards)
- [Creating Concept/Descriptor Flashcards](https://help.remnote.com/en/articles/6751778-creating-concept-descriptor-flashcards)
- [References](https://help.remnote.com/en/articles/6030714-references)
- [Tags](https://help.remnote.com/en/articles/6030770-tags)
- [Portals](https://help.remnote.com/en/articles/6030742-portals)
- [Universal Descriptors](https://help.remnote.com/en/articles/6030778-universal-descriptors)
- [Extra Card Detail Power-Up](https://help.remnote.com/en/articles/6751966-extra-card-detail-power-up)
- [Mastering Flashcards with Effective Hints](https://help.remnote.com/en/articles/9626898-mastering-flashcards-with-effective-hints)
- [Notes on RemNote Importers](https://help.remnote.com/en/articles/6330674-notes-on-remnote-importers)
- [Writing Equations with LaTeX](https://help.remnote.com/en/articles/6565191-writing-equations-with-latex)
- [Using Code Blocks on Flashcards](https://help.remnote.com/en/articles/7967360-using-code-blocks-on-flashcards)
