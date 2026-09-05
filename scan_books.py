#!/usr/bin/env python3
"""扫描 RAZ 视频目录，生成 books.json 书单数据。"""
import json
import re
from pathlib import Path

WORKSPACE = Path("/Users/dingke/小竹学习/通用/英语/A1014-RAZ精读视频")

# 等级目录映射（按文件夹识别等级）
LEVEL_DIRS = {
    "AA级视频（97本）": "AA",
    "A级视频（97本）": "A",
    "B级视频（97本）": "B",
    "C级视频（95本）": "C",
    "D级视频（89本）": "D",
    "E级视频（87本）": "E",
    "F级视频（86本）": "F",
    "G级视频（85本）": "G",
    "H级-视频（80本）": "H",
    "I": "I",
    # 解压后的等级（暂未解压，列入待扫描）
    "J级视频": "J",
    "K级视频": "K",
    "L级视频": "L",
    "M级视频": "M",
    "N级视频": "N",
    "O级视频": "O",
    "P级视频": "P",
    "Q级视频": "Q",
    "R级视频": "R",
    "S级视频": "S",
    "T级视频": "T",
    "U级视频": "U",
    "V级视频": "V",
    "W级视频": "W",
    "X级视频": "X",
    "Y级视频": "Y",
    "Z级视频": "Z",
    "Z1级视频": "Z1",
    "Z2级视频": "Z2",
}

# 等级难度（用于规划）
LEVEL_ORDER = ["AA", "A", "B", "C", "D", "E", "F", "G", "H", "I",
               "J", "K", "L", "M", "N", "O", "P", "Q", "R", "S",
               "T", "U", "V", "W", "X", "Y", "Z", "Z1", "Z2"]


def parse_aa_to_h(name: str, level: str):
    """解析 AA/A/B/.../H 命名。
    支持两种格式：
      AA-01Farm Animals.mp4
      A-Clean Not Clean.mp4 （无序号，按目录顺序补）
    """
    m = re.match(rf"^{re.escape(level)}(?:-(\d+))?\s*(.+?)\.mp4$", name)
    if not m:
        return None
    seq_str = m.group(1)
    return {
        "level": level,
        "seq": int(seq_str) if seq_str else None,
        "title": m.group(2).strip(),
        "code": f"{level}-{seq_str}" if seq_str else None,
    }


def parse_i(name: str):
    """解析 I 级命名: Reading AZ Level I. Title.mp4"""
    m = re.match(r"^Reading AZ Level I\.\s*(.+?)\.mp4$", name)
    if not m:
        return None
    title = m.group(1).strip()
    # 从标题里尝试提取序号（如 "01 Some Title" 不存在，使用文件排序）
    return {
        "level": "I",
        "title": title,
        "code": None,  # I 级没有内置序号
    }


def main():
    books = []
    by_level = {lvl: [] for lvl in LEVEL_ORDER}

    for d, level in LEVEL_DIRS.items():
        p = WORKSPACE / d
        if not p.exists() or not p.is_dir():
            continue
        for f in sorted(p.iterdir()):
            if not f.name.endswith(".mp4"):
                continue
            if level == "I":
                b = parse_i(f.name)
            else:
                b = parse_aa_to_h(f.name, level)
            if b is None:
                print(f"[WARN] 无法解析: {f}")
                continue
            by_level[level].append({**b, "file": f.name})

    # 给 I 级补序号（按文件出现顺序）
    for i, b in enumerate(by_level["I"], 1):
        if b.get("code") is None:
            b["code"] = f"I-{i:02d}"
            b["seq"] = i

    # 合并并加全局 id（按 seq 排序后再补缺）
    for lvl in LEVEL_ORDER:
        items = by_level[lvl]
        for i, b in enumerate(items, 1):
            if b.get("seq") is None:
                b["seq"] = i
            if b.get("code") is None:
                b["code"] = f"{lvl}-{i:02d}"
            b["id"] = f"{lvl}-{b['seq']:02d}-{b['title'][:20]}"
        books.extend(items)

    out = {
        "version": 1,
        "generated_at": "",
        "levels": LEVEL_ORDER,
        "level_names": {
            "AA": "AA", "A": "A", "B": "B", "C": "C", "D": "D",
            "E": "E", "F": "F", "G": "G", "H": "H", "I": "I",
            "J": "J", "K": "K", "L": "L", "M": "M", "N": "N",
            "O": "O", "P": "P", "Q": "Q", "R": "R", "S": "S",
            "T": "T", "U": "U", "V": "V", "W": "W", "X": "X",
            "Y": "Y", "Z": "Z", "Z1": "Z1", "Z2": "Z2",
        },
        "counts": {lvl: len(by_level[lvl]) for lvl in LEVEL_ORDER},
        "books": books,
    }

    out_path = WORKSPACE / "raz-tracker" / "data" / "books.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"\n已生成 {out_path}")
    print(f"总书数: {len(books)}")
    for lvl in LEVEL_ORDER:
        if by_level[lvl]:
            print(f"  {lvl}: {len(by_level[lvl])} 本")


if __name__ == "__main__":
    main()
