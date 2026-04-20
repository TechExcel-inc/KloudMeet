/**
 * getInitials — 生成名字缩写（用于头像显示）
 *
 * 核心规则：
 *  「有意义的名字」（多词/多字，说明是有登录名的用户）→ 取姓名缩写，最多3字符
 *  「单词随手输入的名字」（说明是游客/未登录）        → 直接取前2个字符
 *
 * 具体优先级：
 *  1. 空格分隔 ≥3 词  → 各取首字母前3              "Mary Jane Watson" → MJW
 *  2. 空格分隔  = 2 词 → 首词首字母 + 末词首字母     "张 伟"  → 张伟 | "John Smith" → JS
 *     （中文兼容：姓 + 名首字，英文：名首字 + 姓首字）
 *  3. snake_case / kebab-case（同上逻辑）
 *  4. CamelCase / PascalCase → 所有大写字母前3      "XiaoYuLi" → XYL
 *  5. 纯 CJK（中/日/韩）→ 前3个字符               "李小龙" → 李小龙 | "张伟" → 张伟
 *  6. 单个英文/拼音单词（游客随手输入）→ 前2个字符   "xiaoyu" → xi | "john" → jo
 *  7. 兜底 → 前2个字符
 */
export function getInitials(name: string): string {
  if (!name) return '?';
  const trimmed = name.trim();
  if (!trimmed) return '?';

  // 1 & 2 — 空格分隔词组（有意义的姓名）
  const spaceWords = trimmed.split(/\s+/).filter(Boolean);
  if (spaceWords.length >= 3) {
    // 三词及以上：取前3个词的首字母
    return (
      spaceWords[0][0] +
      spaceWords[1][0] +
      spaceWords[spaceWords.length - 1][0]
    ).toUpperCase();
  }
  if (spaceWords.length === 2) {
    // 两词：姓首字母 + 名首字母（中英文统一取各词首字，简洁可辨识）
    return (spaceWords[0][0] + spaceWords[1][0]).toUpperCase();
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
    return (segments[0][0] + segments[1][0]).toUpperCase();
  }

  // 4 — CamelCase / PascalCase：提取全部大写字母，取前3
  const uppers = trimmed.replace(/[^A-Z]/g, '');
  if (uppers.length >= 2) {
    return uppers.slice(0, 3);
  }

  // 5 — 纯 CJK 字符（中文、日文假名、韩文）→ 前2个字符
  const CJK = /[\u4e00-\u9fa5\u3040-\u30ff\uac00-\ud7af]/;
  if (CJK.test(trimmed)) {
    const cjkChars = Array.from(trimmed).filter((c) => CJK.test(c));
    return cjkChars.slice(0, 2).join('');
  }

  // 6 — 单个英文/拼音单词（游客随手输入，无明确姓名结构）
  //     取前2个字符，简洁直观
  //     xiaoyu → xi | john → jo | zhang → zh
  return trimmed.slice(0, 2).toLowerCase();
}
