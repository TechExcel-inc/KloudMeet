import { describe, expect, it } from 'vitest';
import { liveDocFileBadge } from './liveDocFileBadge';

describe('liveDocFileBadge', () => {
  it('labels files by extension, as the Kloud V3 documents table does', () => {
    expect(liveDocFileBadge(['Q4 roadmap.pptx', 'Q4 roadmap'])).toEqual({ group: 'ppt', label: 'PPT' });
    expect(liveDocFileBadge(['Notes.md'])).toEqual({ group: 'doc', label: 'MD' });
    expect(liveDocFileBadge(['Kloud-20261029222438.png', 'Kloud-20261029222438.png'])).toEqual({
      group: 'image',
      label: 'PNG',
    });
  });

  it('falls back to the icon LiveDoc chose, then FILE', () => {
    expect(liveDocFileBadge(['', 'Brand guide'], '../../../static/assets/images/ppt.svg')).toEqual({
      group: 'ppt',
      label: 'PPT',
    });
    expect(liveDocFileBadge(['', 'Contract scan'], 'no.svg')).toEqual({ group: 'other', label: 'FILE' });
  });

  it('shows the meeting whiteboard as a board, not as an HTML file', () => {
    const board = { group: 'board', label: 'BOARD' };
    expect(
      liveDocFileBadge(['kloud-whiteboard.html', '白板'], 'https://kloud.cn/static/images/meeting-whiteboard-icon.svg'),
    ).toEqual(board);
    expect(liveDocFileBadge(['kloud-whiteboard.html', '白板'])).toEqual(board);
    expect(liveDocFileBadge(['', '白板'], 'https://kloud.cn/static/images/meeting-whiteboard-icon.svg?v=2')).toEqual(
      board,
    );
    expect(liveDocFileBadge(['page.html', 'Page'])).toEqual({ group: 'other', label: 'HTML' });
  });
});
