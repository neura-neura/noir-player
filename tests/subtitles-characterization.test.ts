/* @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { findActiveCueIndex, parseSubtitleText } from '@/lib/subtitles';

describe('subtitle behavior characterization before extraction', () => {
  it('parses SRT cues and keeps sanitized HTML', () => {
    const cues = parseSubtitleText('1\n00:00:01,000 --> 00:00:03,000\n<b>Hello</b><script>alert(1)</script>', 'fixture.srt');
    expect(cues).toHaveLength(1);
    expect(cues[0].startMs).toBe(1_000);
    expect(cues[0].html).toContain('<b>Hello</b>');
    expect(cues[0].html).not.toContain('<script>');
    expect(findActiveCueIndex(cues, 1_500)).toBe(0);
    expect(findActiveCueIndex(cues, 3_500)).toBe(-1);
  });

  it('parses VTT cue timing without depending on the React tree', () => {
    const cues = parseSubtitleText('WEBVTT\n\n00:00:00.500 --> 00:00:01.250\nCaption', 'fixture.vtt');
    expect(cues[0]).toMatchObject({ startMs: 500, endMs: 1_250 });
  });
});
