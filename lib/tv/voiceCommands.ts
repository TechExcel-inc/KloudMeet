/**
 * Spoken (or typed) commands → TV commands, in English, Chinese, Japanese and Korean.
 *
 * Speech comes from the TV's own recogniser or from the phone remote's mic; both end up
 * here as text. Matching is phrase-based on purpose: a meeting room needs a dozen reliable
 * commands, not open conversation, and it must work without a network round trip.
 */
import { normalizeMeetingCode, type TvCommand } from './protocol';

export interface VoiceMatch {
  command: TvCommand;
  /** Lower-cased, punctuation-free text that was matched (for the "Heard …" line) */
  heard: string;
}

const EN_DIGITS: Record<string, string> = {
  zero: '0',
  oh: '0',
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
  six: '6',
  seven: '7',
  eight: '8',
  nine: '9',
  dash: '-',
  hyphen: '-',
  minus: '-',
};

const ZH_DIGITS: Record<string, string> = {
  零: '0',
  〇: '0',
  洞: '0',
  一: '1',
  幺: '1',
  二: '2',
  两: '2',
  三: '3',
  四: '4',
  五: '5',
  六: '6',
  七: '7',
  拐: '7',
  八: '8',
  九: '9',
  杠: '-',
  横杠: '-',
};

/** Lower-case, drop punctuation, collapse spaces. Keeps CJK, letters, digits and dashes. */
export function normalizeUtterance(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[.,!?;:"'“”‘’。，！？；：、（）()[\]{}…·]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Turns "m five eight eight eight" / "幺二三" into "m5888" / "123"; letters stay letters. */
export function spokenCodeToText(text: string): string {
  const words = text.split(' ').filter(Boolean);
  const out = words.map((w) => EN_DIGITS[w] ?? w).join(' ');
  let zh = out;
  for (const [k, v] of Object.entries(ZH_DIGITS).sort((a, b) => b[0].length - a[0].length)) {
    zh = zh.split(k).join(v);
  }
  return zh;
}

const JOIN_FILLER =
  /\b(the|meeting|call|room|code|id|number|please|to|with|now|into|in)\b|会议号|会议室|会议|房间号|房间|号码|号|请|一下|吧|ミーティング|会議|番号|コード|に|へ|を|회의|번호|코드|에|을|를/g;

function extractJoinCode(rest: string): string | null {
  const cleaned = spokenCodeToText(rest.replace(JOIN_FILLER, ' ')).replace(/\s+/g, '');
  return cleaned.length >= 3 ? normalizeMeetingCode(cleaned) : null;
}

type Rule = { re: RegExp; cmd: TvCommand | ((m: RegExpMatchArray) => TvCommand | null) };

/**
 * Order matters: "unmute" before "mute", "取消举手" before "举手", "mute the sound" (speaker)
 * before "mute" (microphone), "end meeting for everyone" before "end meeting".
 */
const RULES: Rule[] = [
  // ── Confirm / cancel (answers to "Leave the meeting?") ──
  { re: /^(yes|yeah|yep|confirm|ok|okay|sure|do it|确定|确认|是的?|好的?|对|はい|確認|네|예|확인)$/, cmd: { type: 'confirm' } },
  { re: /^(no|nope|cancel|never ?mind|stop|取消|不要|不用|算了|いいえ|キャンセル|아니요?|취소)$/, cmd: { type: 'cancel' } },

  // ── Speaker volume ──
  { re: /\b(mute|silence) (the )?(sound|audio|speakers?|tv|television|volume)\b|关闭声音|关掉声音|电视静音|消音|スピーカーをミュート|消音にして|소리 끄기|스피커 음소거/, cmd: { type: 'volume', muted: true } },
  { re: /\bunmute (the )?(sound|audio|speakers?|tv|television|volume)\b|打开声音|恢复声音|スピーカーのミュート解除|소리 켜기/, cmd: { type: 'volume', muted: false } },
  {
    re: /\b(?:set )?volume (?:to |at )?(\d{1,3})\b|音量(?:调到|调成|设为|设置为|到)?(\d{1,3})|音量を?(\d{1,3})|볼륨 ?(\d{1,3})/,
    cmd: (m) => {
      const n = Number(m[1] ?? m[2] ?? m[3] ?? m[4]);
      return Number.isFinite(n) ? { type: 'volume', level: Math.max(0, Math.min(100, n)) } : null;
    },
  },
  { re: /\b(volume up|louder|turn (it )?up|increase (the )?volume|raise (the )?volume)\b|大声|音量调大|调大音量|声音大|增大音量|加大音量|音量大一|音量を上げ|音を大きく|ボリュームを上げ|볼륨 (높여|올려|업)|소리 (크게|키워)/, cmd: { type: 'volume', delta: 10 } },
  { re: /\b(volume down|quieter|softer|turn (it )?down|decrease (the )?volume|lower (the )?volume)\b|小声|音量调小|调小音量|声音小|减小音量|降低音量|音量小一|音量を下げ|音を小さく|ボリュームを下げ|볼륨 (낮춰|내려|다운)|소리 (작게|줄여)/, cmd: { type: 'volume', delta: -10 } },

  // ── Microphone ──
  { re: /\bunmute\b|\b(turn on|enable|start|open) (the |my )?(mic|microphone)\b|\b(mic|microphone) on\b|取消静音|解除静音|打开麦克风|开启麦克风|开麦|ミュート解除|ミュートを解除|マイクをオン|マイクオン|음소거 해제|마이크 (켜|켜기|켜줘|온)/, cmd: { type: 'mic', on: true } },
  { re: /\bmute\b|\b(turn off|disable|stop|close) (the |my )?(mic|microphone)\b|\b(mic|microphone) off\b|静音|关闭麦克风|关掉麦克风|关麦|闭麦|ミュート|マイクをオフ|マイクオフ|음소거|마이크 (꺼|끄기|꺼줘|오프)/, cmd: { type: 'mic', on: false } },

  // ── Camera ──
  { re: /\b(turn on|enable|start|open) (the |my )?(camera|video|webcam)\b|\b(camera|video) on\b|打开摄像头|开启摄像头|开摄像头|打开视频|开启视频|开视频|カメラをオン|カメラオン|ビデオをオン|ビデオを開始|카메라 (켜|켜기|켜줘|온)|비디오 (켜|켜기|시작)/, cmd: { type: 'cam', on: true } },
  { re: /\b(turn off|disable|stop|close) (the |my )?(camera|video|webcam)\b|\b(camera|video) off\b|关闭摄像头|关掉摄像头|关摄像头|关闭视频|关掉视频|停止视频|关视频|カメラをオフ|カメラオフ|ビデオをオフ|ビデオを停止|카메라 (꺼|끄기|꺼줘|오프)|비디오 (꺼|끄기|중지)/, cmd: { type: 'cam', on: false } },

  // ── Captions ──
  { re: /\b(turn on|enable|start|show|open) (the )?(captions?|subtitles?|cc)\b|\b(captions?|subtitles?) on\b|打开字幕|开启字幕|显示字幕|开字幕|字幕をオン|字幕を表示|字幕オン|자막 (켜|켜기|켜줘|표시|보기)/, cmd: { type: 'captions', on: true } },
  { re: /\b(turn off|disable|stop|hide|close) (the )?(captions?|subtitles?|cc)\b|\b(captions?|subtitles?) off\b|关闭字幕|关掉字幕|隐藏字幕|关字幕|字幕をオフ|字幕を非表示|字幕オフ|자막 (꺼|끄기|꺼줘|숨기기|숨겨)/, cmd: { type: 'captions', on: false } },

  // ── Hand ──
  { re: /\b(lower|put down|drop) (my |the )?hand\b|取消举手|放下手|把手放下|手放下|手を下ろ|挙手を取り消|挙手をやめ|손 ?내리기|손 ?내려/, cmd: { type: 'hand', on: false } },
  { re: /\b(raise|put up) (my |the |a )?hand\b|举手|手を挙げ|挙手|손 ?들기|손 ?들어/, cmd: { type: 'hand', on: true } },

  // ── Leave / end ──
  { re: /\bend (the )?(meeting|call) for (all|everyone|everybody)\b|为所有人结束|结束所有人的会议|全员结束|全員の会議を終了|全員終了|모두에게 회의 종료|전체 종료/, cmd: { type: 'endForAll' } },
  { re: /\b(leave|exit|quit) (the )?(meeting|call|room)\b|\bhang up\b|\bend (the )?(meeting|call)\b|^leave$|离开会议|退出会议|离会|挂断|结束通话|结束会议|会議を退出|会議から退出|退室|通話を終了|退出して|회의 나가기|회의에서 나가|나가기|통화 종료|회의 종료/, cmd: { type: 'leave' } },

  // ── Views ──
  { re: /\b(show|open|go to|switch to) (the )?(document|doc|docs|slides?|presentation|livedoc|live doc)\b|看文档|显示文档|打开文档|切换到文档|文档视图|看课件|資料を表示|ドキュメントを表示|資料を見|문서 (보기|보여|열어)|자료 (보기|보여)/, cmd: { type: 'view', view: 'liveDoc' } },
  { re: /\b(show|open|go to|switch to) (the )?(shared )?screen( share)?\b|\bscreen share\b|看共享|看屏幕共享|显示共享|屏幕共享|共享屏幕|画面共有を表示|画面共有を見|共有画面|화면 ?공유 (보기|보여)|공유 화면/, cmd: { type: 'view', view: 'shareScreen' } },
  { re: /\b(show|open|go to|switch to) (the )?design\b|看设计|显示设计|デザインを表示|디자인 (보기|보여)/, cmd: { type: 'view', view: 'design' } },
  { re: /\b(show|go to|switch to) (the )?(video|videos|people|cameras?|faces|webcams?|everyone)\b|看视频|显示视频|视频画面|看人|看大家|ビデオを表示|カメラを表示|みんなを表示|비디오 (보기|보여)|사람 (보기|보여)/, cmd: { type: 'view', view: 'webcam' } },

  // ── Layout ──
  { re: /\b(grid|gallery|tile|tiled)( view| layout)?\b|宫格|九宫格|画廊|平铺|グリッド|ギャラリー|タイル|그리드|갤러리|바둑판/, cmd: { type: 'layout', mode: 'tile' } },
  { re: /\b(speaker|spotlight|focus)( view| layout| mode)?\b|演讲者|主讲人|焦点视图|聚焦|スピーカー|スポットライト|발표자|스포트라이트/, cmd: { type: 'layout', mode: 'spotlight' } },

  // ── Panels ──
  { re: /\b(show|open) (the )?(participants|people|attendees)\b|\bwho( s| is)? (here|in the meeting)\b|\bparticipants\b|参会者|参会人|与会者|成员列表|谁在会|参加者|참가자|참석자/, cmd: { type: 'panel', panel: 'people' } },
  { re: /\b(show|open) (the )?chat\b|\bchat\b|打开聊天|聊天|チャット|채팅/, cmd: { type: 'panel', panel: 'chat' } },
  { re: /\b(close|hide)( (it|this|that|the panel|panel|participants|people|chat))?\b|关闭面板|关掉|关闭|閉じる|닫기|닫아/, cmd: { type: 'panel', panel: null } },

  // ── Navigation ──
  { re: /\b(go )?home\b|\bhome screen\b|回到主页|回主页|主页|首页|ホーム|홈/, cmd: { type: 'home' } },
  { re: /\b(go )?back\b|返回|后退|戻る|뒤로/, cmd: { type: 'key', key: 'back' } },
  { re: /\bhelp\b|\bwhat can i say\b|\bcommands\b|帮助|能说什么|可以说什么|怎么用|ヘルプ|何が言える|도움말|뭐라고 말/, cmd: { type: 'help' } },
];

const JOIN_RE = new RegExp(
  [
    '^(?:please )?join\\b(.*)$',
    '^(?:please )?(?:open|enter|start|go to|dial into|call into) (?:the )?(?:meeting|room|call)\\b(.*)$',
    '^(?:加入|进入|入会|参加)(.*)$',
    '^(.*?)(?:に参加|へ参加|に入る|に入室|に接続)(?:して|する|します)?.*$',
    '^(?:会議に参加|参加)(.*)$',
    '^(.*?)(?:에 참가|에 참여|에 들어가|에 입장)(?:해|하기)?.*$',
    '^(?:회의 참가|참가|입장)(.*)$',
  ].join('|'),
);

/** The command in `text`, or null when nothing matched. */
export function parseVoiceCommand(text: string): VoiceMatch | null {
  const heard = normalizeUtterance(text);
  if (!heard) return null;

  const join = heard.match(JOIN_RE);
  if (join) {
    const rest = join.slice(1).find((g) => typeof g === 'string' && g.trim().length > 0) ?? '';
    const code = extractJoinCode(rest);
    if (code) return { command: { type: 'join', code }, heard };
  }

  for (const rule of RULES) {
    const m = heard.match(rule.re);
    if (!m) continue;
    const command = typeof rule.cmd === 'function' ? rule.cmd(m) : rule.cmd;
    if (command) return { command, heard };
  }
  return null;
}

/** Example phrases shown on the TV's voice help (English UI copy). */
export const VOICE_EXAMPLES = [
  'Join meeting abc-defg-hij',
  'Mute / Unmute',
  'Turn on captions',
  'Show the document',
  'Grid view',
  'Raise my hand',
  'Volume up',
  'Leave meeting',
];
