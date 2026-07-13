import argparse
import json
import re
import sys
from pathlib import Path


def read_text(path: str | None) -> str:
    if path and path != "-":
        return Path(path).read_text(encoding="utf-8-sig")
    return sys.stdin.read()


def add_issue(
    issues: list[dict[str, object]],
    severity: str,
    line_number: int,
    message: str,
) -> None:
    issues.append(
        {"severity": severity, "line": line_number, "message": message}
    )


def count_line_cards(line: str) -> tuple[int, int, bool]:
    directions = 0
    clozes = len(re.findall(r"\{\{(?!\[).+?\}\}", line))

    ordered_patterns = (
        (r">-A\)", 0),
        (r">>A\)", 1),
        (r">-1\.", 0),
        (r"<>1\.", 2),
        (r"<<1\.", 1),
        (r">>1\.", 1),
        (r"<><", 2),
        (r"<<<", 1),
        (r">>>", 1),
        (r";;<", 2),
        (r";<", 1),
        (r";-", 0),
        (r";;", 1),
        (r":-", 0),
        (r":<", 1),
        (r":>", 1),
        (r"::", 2),
        (r">-", 0),
        (r"<>|><", 2),
        (r"<<", 1),
        (r">>|==", 1),
    )

    matched = False
    for pattern, value in ordered_patterns:
        if re.search(pattern, line):
            directions = value
            matched = True
            break

    return directions, clozes, directions > 0 or clozes > 0


def analyze(text: str, mcp_mode: bool = False) -> dict[str, object]:
    lines = text.splitlines()
    issues: list[dict[str, object]] = []
    producing_rems = 0
    directions = 0
    clozes = 0

    for index, line in enumerate(lines):
        line_number = index + 1
        stripped = line.strip()

        if "\t" in line[: len(line) - len(line.lstrip())]:
            add_issue(
                issues,
                "ERROR",
                line_number,
                "层级缩进含 Tab；改用一致数量的空格。",
            )

        if re.search(r"/(?:hint|ecd)\b", line, flags=re.IGNORECASE):
            message = (
                "/hint 在 MCP 直写中槽位映射不可靠；用 update_note 的 frontCardHint/backCardHint。"
                if mcp_mode
                else "/hint、/ecd 是编辑器命令，不是通用文本导入语法。"
            )
            add_issue(issues, "ERROR", line_number, message)

        if re.search(r"/extra\b", line, flags=re.IGNORECASE) and not mcp_mode:
            add_issue(
                issues,
                "ERROR",
                line_number,
                "/extra 是编辑器命令，粘贴模式用 #[[Extra Card Detail]]；仅 MCP 直写管道支持 /extra 子行。",
            )

        reference_check = line.replace("#[[Extra Card Detail]]", "")
        if mcp_mode:
            reference_check = re.sub(r"\[\[id:[^\]\s]+\]\]", "", reference_check)
        if "[[" in reference_check or "]]" in reference_check:
            message = (
                "MCP 直写只保证 [[id:<remId>]] 精确引用；[[名称]] 不会解析为既有 Rem。"
                if mcp_mode
                else "纯文本粘贴不保证把 [[名称]] 解析为既有 Rem Reference。"
            )
            add_issue(issues, "ERROR", line_number, message)

        if "{{[[" in line:
            add_issue(
                issues,
                "ERROR",
                line_number,
                "{{[[...]]}} 不是 Portal 文本语法，并可能被解释为 Cloze。",
            )

        for token, replacement in (("::-", ":-"), ("=-", ">-"), (";<>", ";;<")):
            if token in line:
                add_issue(
                    issues,
                    "ERROR",
                    line_number,
                    f"不可靠的文本导入分隔符 {token}；此处通常应使用 {replacement}。",
                )

        if re.search(
            r"(?:;>>|:<<|;;>|;<<|::1\.|:-1\.|;;<1\.|;-1\.|:-A\)|;-A\))",
            line,
        ):
            add_issue(
                issues,
                "WARNING",
                line_number,
                "检测到高级 Concept/Descriptor 多行、列表或选择题分隔符；官方页面内部存在矛盾，改用普通 Concept 下的 Basic 卡更稳妥。",
            )

        if re.search(r"^\s*~[^;\n]+;(?:;<?|<|-)", line):
            add_issue(
                issues,
                "WARNING",
                line_number,
                "~ 前缀不会自动创建 Universal Descriptor；确认这是有意的普通 Descriptor。",
            )

        if re.search(r"(?:^|\s)#(?!\[\[Extra Card Detail\]\])[^\s#]+", line):
            add_issue(
                issues,
                "WARNING",
                line_number,
                "普通 #标签 没有官方文本粘贴解析保证；考虑导入后手动加 Tag。",
            )

        if "```" in line:
            add_issue(
                issues,
                "WARNING",
                line_number,
                "Markdown 代码围栏的卡片粘贴行为未获文本导入页保证；导入后检查结构。",
            )

        for match in re.finditer(r"(?<!\$)\$[^$\n]+\$(?!\$)", line):
            before = line[match.start() - 1] if match.start() > 0 else ""
            after = line[match.end()] if match.end() < len(line) else ""
            if not before.isspace() or not after.isspace():
                add_issue(
                    issues,
                    "WARNING",
                    line_number,
                    "单美元符号公式前后需有空格；行末公式可改用 $$...$$。",
                )

        line_directions, line_clozes, produces_cards = count_line_cards(line)
        directions += line_directions
        clozes += line_clozes
        if produces_cards:
            producing_rems += 1

        if stripped.endswith(">>>"):
            parent_indent = len(line) - len(line.lstrip(" "))
            next_index = index + 1
            while next_index < len(lines) and not lines[next_index].strip():
                next_index += 1
            if next_index < len(lines):
                child = lines[next_index]
                child_indent = len(child) - len(child.lstrip(" "))
                child_text = child.strip()
                if child_indent > parent_indent and re.match(r"(?:-\s*)?\d+\.\s+", child_text):
                    add_issue(
                        issues,
                        "WARNING",
                        line_number,
                        "父项使用 >>> 但子项带编号；若要逐项按序测试，请把父项改为 >>1.。",
                    )

        if re.search(r"(?:>>|<<|<>)1\.$", stripped):
            parent_indent = len(line) - len(line.lstrip(" "))
            next_index = index + 1
            while next_index < len(lines) and not lines[next_index].strip():
                next_index += 1
            if next_index < len(lines):
                child = lines[next_index]
                child_indent = len(child) - len(child.lstrip(" "))
                child_text = child.strip()
                if child_indent > parent_indent and re.match(r"(?:-\s*)?\d+\.\s+", child_text):
                    add_issue(
                        issues,
                        "WARNING",
                        line_number,
                        "List 卡子项自带编号；RemNote 导入后会按顺序自动编号，手写编号将造成重复。",
                    )

        if re.search(r"(?:>>>|<<<|<><|>>1\.|<<1\.|<>1\.|>>A\))$", stripped):
            parent_indent = len(line) - len(line.lstrip(" "))
            next_index = index + 1
            while next_index < len(lines) and not lines[next_index].strip():
                next_index += 1
            if next_index >= len(lines):
                add_issue(
                    issues,
                    "ERROR",
                    line_number,
                    "多行卡、列表卡或选择题没有缩进子项。",
                )
            else:
                child = lines[next_index]
                child_indent = len(child) - len(child.lstrip(" "))
                if child_indent <= parent_indent:
                    add_issue(
                        issues,
                        "ERROR",
                        line_number,
                        "多行卡、列表卡或选择题的首个子项必须缩进在父项下。",
                    )

    return {
        "producing_rems": producing_rems,
        "review_directions": directions,
        "cloze_occlusions": clozes,
        "initial_reviews_total": directions + clozes,
        "issues": issues,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="检查 RemNote 可粘贴文本中的高风险语法并估算初始复习方向。"
    )
    parser.add_argument(
        "path",
        nargs="?",
        help="UTF-8 文本文件；省略或传入 - 时读取 stdin",
    )
    parser.add_argument("--json", action="store_true", dest="as_json")
    parser.add_argument(
        "--mcp",
        action="store_true",
        dest="mcp_mode",
        help="MCP 直写模式：放行 [[id:<remId>]] 与 /extra 子行，仍拦截 /hint",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="把 WARNING 也视为非零退出状态",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    result = analyze(read_text(args.path), mcp_mode=args.mcp_mode)
    issues = result["issues"]

    if args.as_json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print(f"产卡 Rem 数：{result['producing_rems']}")
        print(f"卡片方向数：{result['review_directions']}")
        print(f"Cloze 遮挡数：{result['cloze_occlusions']}")
        print(f"初始复习方向/遮挡合计：{result['initial_reviews_total']}")
        if issues:
            for issue in issues:
                print(
                    f"{issue['severity']} L{issue['line']}: {issue['message']}"
                )
        else:
            print("未发现高风险文本导入语法。")

    has_error = any(issue["severity"] == "ERROR" for issue in issues)
    has_warning = any(issue["severity"] == "WARNING" for issue in issues)
    if has_error or (args.strict and has_warning):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
