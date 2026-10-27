import { describe, expect, it } from 'vitest';
import { countNewUnread, mergeChatMessages, setChatSendFailed, type ChatMsg } from './chatProtocol';

const msg = (id: string, ts: number, isLocal = false): ChatMsg => ({
  clientMessageId: id,
  senderIdentity: isLocal ? 'me' : 'other',
  senderName: isLocal ? 'Me' : 'Other',
  message: id,
  timestamp: ts,
  isLocal,
});

describe('mergeChatMessages', () => {
  it('keeps one copy per id, oldest first, the later copy winning', () => {
    const merged = mergeChatMessages([msg('b', 2), { ...msg('a', 1, true), sendFailed: true }], [msg('a', 1, true), msg('c', 3)]);
    expect(merged.map((m) => m.clientMessageId)).toEqual(['a', 'b', 'c']);
    expect(merged[0].sendFailed).toBeUndefined();
  });
});

describe('countNewUnread', () => {
  it("counts only other people's messages not seen before", () => {
    const current = [msg('a', 1), msg('b', 2, true)];
    expect(countNewUnread(current, [msg('a', 1), msg('c', 3), msg('d', 4, true), msg('e', 5)])).toBe(2);
    expect(countNewUnread(current, [])).toBe(0);
  });
});

describe('setChatSendFailed', () => {
  it('marks and clears one message', () => {
    const marked = setChatSendFailed([msg('a', 1, true), msg('b', 2, true)], 'b', true);
    expect(marked.map((m) => !!m.sendFailed)).toEqual([false, true]);
    expect(setChatSendFailed(marked, 'b', false)[1].sendFailed).toBeUndefined();
  });
});
