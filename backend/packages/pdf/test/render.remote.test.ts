import { describe, it, expect } from 'vitest';
describe('renderPdf (remote)', () => {
  it('produces a valid PDF from HTML', async () => {
    const base = process.env.PDF_WORKER_URL!;
    const res = await fetch(`${base}/debug/render?html=${encodeURIComponent('<h1>hi</h1>')}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/pdf');
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(new TextDecoder().decode(buf.slice(0, 5))).toBe('%PDF-');
    expect(buf.byteLength).toBeGreaterThan(500);
  });
});
