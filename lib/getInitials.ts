/**
 * getInitials — 生成最多 3 个字符的可辨识名字缩写
 *
 * 优先级规则：
 *  1. 空格分隔 ≥3 词 → 前三词各取首字母          "Mary Jane Watson" → MJW
 *  2. 空格分隔  = 2 词 → 首词前2字母 + 末词首字母  "John Smith"       → JOS
 *  3. snake_case / kebab-case（同上逻辑）
 *  4. CamelCase / PascalCase → 取所有大写字母前3   "XiaoYuLi"         → XYL
 *  5. 纯 CJK（中/日/韩）→ 直接取前3字符           "李小龙"           → 李小龙
 *  6. 纯英文单词 → 取首、中、末 共3字符            "xiaoyu"           → XYU
 *  7. 兜底 → 前3字符大写
 *
 *  ※ 中文2字名（如"张伟"）不强制补第3字，保持原样。
 */
export function getInitials(name: string): string {
  if (!name) return '?';
  const trimmed = name.trim();
  if (!trimmed) return '?';

  // 1 & 2 — 空格分隔词组
  const spaceWords = trimmed.split(/\s+/).filter(Boolean);
  if (spaceWords.length >= 3) {
    return (
      spaceWords[0][0] +
      spaceWords[1][0] +
      spaceWords[spaceWords.length - 1][0]
    ).toUpperCase();
  }
  if (spaceWords.length === 2) {
    // 首词前2字母 + 末词首字母，让姓氏更清晰
    const a = spaceWords[0].slice(0, 2);
    const b = spaceWords[1][0];
    return (a + b).toUpperCase().slice(0, 3);
  }

  // 3 — snake_case / kebab-case
  const segments = trimmed.split(/[_\-]+/).filter(Boolean);
  if (segments.length >= 3) {
    return (
      segments[0][0] +
      segments[1][0] +
      segments[segments.length - 1][0]
    ).toUpperCase();
  }
  if (segments.length === 2) {
    const a = segments[0].slice(0, 2);
    const b = segments[1][0];
    return (a + b).toUpperCase().slice(0, 3);
  }

  // 4 — CamelCase / PascalCase：提取全部大写字母，取前 3
  const uppers = trimmed.replace(/[^A-Z]/g, '');
  if (uppers.length >= 2) {
    return uppers.slice(0, 3);
  }

  // 5 — 纯 CJK 字符（中文、日文假名、韩文）
  const CJK = /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/;
  if (CJK.test(trimmed)) {
    // 取前 3 个 CJK 字符（不足时保持原长，不填充）
    const cjkChars = Array.from(trimmed).filter((c) => CJK.test(c));
    return cjkChars.slice(0, 3).join('');
  }

  // 6 — 纯英文单词：音节起始辅音法
  //   规则：每当「元音之后紧跟辅音」时，该辅音视为新音节的开头
  //   starters = 所有音节开头字母（首字母 + 各音节起始辅音）
  //
  //   ≥3 starters → 取前 3                         password → P+S+R → PSR
  //    = 2 starters → [0]+[1] + 末字母              xiaoyu   → X+Y+U → XYU
  //                                                  zhangsan → Z+S+N → ZSN
  //    = 1 starter  → 首+中+末（单音节）             strength → S+R+H → SRH
  if (/^[a-zA-Z]+$/.test(trimmed)) {
    if (trimmed.length <= 3) return trimmed.toUpperCase();

    const VOWEL = /[aeiou]/i;
    const starters: string[] = [trimmed[0]];
    for (let i = 0; i < trimmed.length - 1; i++) {
      if (VOWEL.test(trimmed[i]) && !VOWEL.test(trimmed[i + 1])) {
        starters.push(trimmed[i + 1]);
      }
    }

    if (starters.length >= 3) {
      return starters.slice(0, 3).join('').toUpperCase();
    }

    if (starters.length === 2) {
      const last = trimmed[trimmed.length - 1];
      // 末字母与 starters[1] 重复时，改取中间字符
      if (last.toLowerCase() !== starters[1].toLowerCase()) {
        return (starters[0] + starters[1] + last).toUpperCase();
      }
      const mid = trimmed[Math.floor(trimmed.length / 2)];
      return (starters[0] + starters[1] + mid).toUpperCase().slice(0, 3);
    }

    // 单音节兜底：首 + 中 + 末
    const mid = Math.floor(trimmed.length / 2);
    return (trimmed[0] + trimmed[mid] + trimmed[trimmed.length - 1]).toUpperCase();
  }

  // 7 — 兜底：前 3 个字符
  return trimmed.slice(0, 3).toUpperCase();
}
