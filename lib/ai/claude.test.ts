import { describe, expect, it } from 'vitest';
import { fileBlock } from './claude';

describe('fileBlock', () => {
  it('sends images as image blocks', () => {
    for (const name of ['scan.png', 'photo.JPG', 'permit.jpeg', 'logo.gif', 'shot.webp']) {
      expect(fileBlock('file_1', name)).toEqual({ type: 'image', source: { type: 'file', file_id: 'file_1' } });
    }
  });

  it('sends everything else as a document', () => {
    for (const name of ['filing.pdf', 'notes.txt', 'no-extension', 'archive.png.pdf']) {
      expect(fileBlock('file_2', name)).toEqual({ type: 'document', source: { type: 'file', file_id: 'file_2' } });
    }
  });

  it('titles documents but never images', () => {
    expect(fileBlock('file_3', 'filing.pdf', 'Complaint')).toEqual({
      type: 'document', source: { type: 'file', file_id: 'file_3' }, title: 'Complaint',
    });
    expect(fileBlock('file_4', 'scan.png', 'Complaint')).not.toHaveProperty('title');
  });
});
