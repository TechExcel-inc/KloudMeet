export interface TimedSentence {
  /** 相对录像文件起点的毫秒 */
  startMs: number;
  endMs: number;
  text: string;
}

export interface SpeakWindow {
  identity: string;
  name: string;
  /** 相对录像文件起点的毫秒（已扣除说话检测延迟） */
  startMs: number;
  endMs: number;
  avgLevel: number;
}

export interface AlignedSentence extends TimedSentence {
  speakerName: string;
}

/** LiveKit 说话检测相对录像声音的大致滞后，换算区间时整体前移 */
export const SPEAK_LAG_MS = 500;

export const UNKNOWN_SPEAKER = 'Unknown';

/** 句子窗口两侧放宽，容忍区间边界误差 */
const PAD_MS = 300;
/** 句子没有任何重叠区间时，取这个距离内最近的说话人 */
const NEAREST_MS = 1500;
/** 音量过小时的下限权重，避免低音量区间完全不计分 */
const MIN_LEVEL = 0.05;

function nearestSpeaker(sentence: TimedSentence, windows: SpeakWindow[]): string {
  let best = UNKNOWN_SPEAKER;
  let gap = NEAREST_MS;
  for (const win of windows) {
    const distance = Math.max(win.startMs - sentence.endMs, sentence.startMs - win.endMs);
    if (distance <= gap) {
      gap = distance;
      best = win.name;
    }
  }
  return best;
}

/**
 * alignSpeakTranscript — 用说话区间为每句识别结果确定说话人
 *
 * 每个候选人得分 = Σ(与句子窗口的重叠毫秒 × 区间平均音量)，取最高分；
 * 无重叠时退回最近的说话人，仍找不到则标记为 UNKNOWN_SPEAKER。
 *
 * @param sentences  批量识别得到的句子（相对录像起点）
 * @param windows    说话区间（相对录像起点）
 * @returns 带 speakerName 的句子，顺序与输入一致
 */
export function alignSpeakTranscript(
  sentences: TimedSentence[],
  windows: SpeakWindow[],
): AlignedSentence[] {
  return sentences.map((sentence) => {
    const from = sentence.startMs - PAD_MS;
    const to = sentence.endMs + PAD_MS;
    const scores = new Map<string, { name: string; score: number }>();
    for (const win of windows) {
      const overlap = Math.min(to, win.endMs) - Math.max(from, win.startMs);
      if (overlap <= 0) continue;
      const entry = scores.get(win.identity) ?? { name: win.name, score: 0 };
      entry.score += overlap * Math.max(win.avgLevel, MIN_LEVEL);
      scores.set(win.identity, entry);
    }
    const top = Array.from(scores.values()).sort((a, b) => b.score - a.score)[0];
    return {
      ...sentence,
      speakerName: top ? top.name : nearestSpeaker(sentence, windows),
    };
  });
}
