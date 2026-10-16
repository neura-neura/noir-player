/* @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { findActiveCueIndex, getSubtitleCueHtml, parseSubtitleText } from '@/lib/subtitles';

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

  it('reveals timed words at their absolute timestamps, including after seeking backwards', () => {
    const [cue] = parseSubtitleText('WEBVTT\n\n00:01.000 --> 00:04.000\n<v Speaker><b>Hola <00:01.500><c>mundo</c> <00:02.250>otra vez</b></v>', 'words.vtt');
    expect(getSubtitleCueHtml(cue, 999)).toBe('');
    expect(getSubtitleCueHtml(cue, 1_499)).toBe('<b>Hola </b>');
    expect(getSubtitleCueHtml(cue, 1_500)).toBe('<b>Hola mundo </b>');
    expect(getSubtitleCueHtml(cue, 2_250)).toBe('<b>Hola mundo otra vez</b>');
    expect(getSubtitleCueHtml(cue, 1_100)).toBe('<b>Hola </b>');
    expect(getSubtitleCueHtml(cue, 4_000)).toBe('');
  });

  it('ignores non-increasing and out-of-cue word times and sanitizes every prefix', () => {
    const [cue] = parseSubtitleText('00:00:01.000 --> 00:00:04.000\n<00:00:00.500><script>alert(1)</script>A <00:00:02.000>B <00:00:01.500>C <00:00:08.000>D<img src=x onerror=alert(1)>');
    expect(cue.reveals?.map((frame) => frame.startMs)).toEqual([1_000, 2_000]);
    expect(getSubtitleCueHtml(cue, 1_000)).toBe('A ');
    expect(getSubtitleCueHtml(cue, 2_000)).toBe('A B C D');
  });

  it('keeps untimed rolling lines at their real times and switches at an exact boundary', () => {
    const cues = parseSubtitleText('WEBVTT\n\n00:00.120 --> 00:01.990\nPrimera línea\n\n00:01.990 --> 00:02.000\nPrimera línea\n\n00:02.000 --> 00:04.269\nPrimera línea\nSegunda línea');
    expect(cues.every((cue) => !cue.reveals)).toBe(true);
    expect(findActiveCueIndex(cues, 1_990)).toBe(1);
    expect(findActiveCueIndex(cues, 2_000)).toBe(2);
    expect(getSubtitleCueHtml(cues[2], 2_000)).toBe('Primera línea<br>Segunda línea');
    expect(findActiveCueIndex(cues, 4_269)).toBe(-1);
  });

  it('reads the actual MP4 extraction including its leading blank payload line', () => {
    const rawText = readFileSync('tests/fixtures/embedded-rolling.vtt', 'utf8');
    const cues = parseSubtitleText(rawText, 'embedded.vtt');
    expect(cues).toHaveLength(7);
    expect(cues[0]).toEqual({ startMs: 120, endMs: 1_990, html: 'Cuando una población se ve distraída por' });
    expect(cues[2].html).toBe('Cuando una población se ve distraída por<br>trivialidades, cuando la vida cultural');
    expect(cues.every((cue) => !cue.reveals)).toBe(true);
  });
});
