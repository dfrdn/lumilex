import { describe, it, expect } from 'vitest';
import { chatAttachmentPrefix, channelOfAttachment, isAttachmentOfChannel } from './attachment-path';

const FIRM = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const CH = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const CH2 = 'ffffffff-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const key = `${FIRM}/chat/${CH}/f1/note.pdf`;

describe('chat attachment keys', () => {
  it('live under the firm prefix and the channel', () => {
    expect(chatAttachmentPrefix(FIRM, CH)).toBe(`${FIRM}/chat/${CH}`);
  });

  it('resolve to their channel', () => {
    expect(channelOfAttachment(FIRM, key)).toBe(CH);
  });

  it("refuse another firm's key, the old bucket-prefixed shape, and traversal", () => {
    expect(channelOfAttachment(OTHER, key)).toBeNull();
    expect(channelOfAttachment(FIRM, `chat-attachments/${CH}/f1/note.pdf`)).toBeNull();
    expect(channelOfAttachment(FIRM, `${FIRM}/chat/${CH}/../../x`)).toBeNull();
    expect(channelOfAttachment(FIRM, `${FIRM}/chat/not-a-channel/f1/x.pdf`)).toBeNull();
    expect(channelOfAttachment(FIRM, null)).toBeNull();
  });

  it('match only their own channel', () => {
    expect(isAttachmentOfChannel(FIRM, CH, key)).toBe(true);
    expect(isAttachmentOfChannel(FIRM, CH2, key)).toBe(false);
    expect(isAttachmentOfChannel(OTHER, CH, key)).toBe(false);
    expect(isAttachmentOfChannel(FIRM, CH, 42)).toBe(false);
  });
});
