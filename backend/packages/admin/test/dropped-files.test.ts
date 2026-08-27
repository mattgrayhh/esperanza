import { describe, it, expect } from 'vitest';
import { filterAcceptedFiles } from '../lib/dropped-files';

function file(name: string, type: string): File {
  return new File(['x'], name, { type });
}

describe('filterAcceptedFiles', () => {
  it('keeps image files for an image/* accept list', () => {
    const files = [file('a.jpg', 'image/jpeg'), file('b.png', 'image/png')];
    expect(filterAcceptedFiles(files, 'image/*')).toEqual(files);
  });

  it('drops non-image files for an image/* accept list', () => {
    const files = [file('a.jpg', 'image/jpeg'), file('doc.pdf', 'application/pdf'), file('v.mp4', 'video/mp4')];
    const out = filterAcceptedFiles(files, 'image/*');
    expect(out.map((f) => f.name)).toEqual(['a.jpg']);
  });

  it('accepts exact mime entries alongside wildcards (image/*,application/pdf)', () => {
    const files = [file('a.webp', 'image/webp'), file('doc.pdf', 'application/pdf'), file('v.mp4', 'video/mp4')];
    const out = filterAcceptedFiles(files, 'image/*,application/pdf');
    expect(out.map((f) => f.name)).toEqual(['a.webp', 'doc.pdf']);
  });

  it('preserves the original drop order', () => {
    const files = [file('3.png', 'image/png'), file('1.jpg', 'image/jpeg'), file('2.gif', 'image/gif')];
    const out = filterAcceptedFiles(files, 'image/*');
    expect(out.map((f) => f.name)).toEqual(['3.png', '1.jpg', '2.gif']);
  });

  it('falls back to the filename extension when the file has no mime type', () => {
    const files = [file('photo.jpeg', ''), file('scan.pdf', ''), file('notes.txt', '')];
    expect(filterAcceptedFiles(files, 'image/*').map((f) => f.name)).toEqual(['photo.jpeg']);
    expect(filterAcceptedFiles(files, 'image/*,application/pdf').map((f) => f.name)).toEqual([
      'photo.jpeg',
      'scan.pdf',
    ]);
  });

  it('returns an empty array for an empty drop', () => {
    expect(filterAcceptedFiles([], 'image/*')).toEqual([]);
  });
});
