/**
 * Tests for TradingView-style hierarchical time axis on intraday charts:
 * 1. Low zoom on 15m: only clean day numbers (6, 7, 8, 9, 12, 13, 14, 15).
 * 2. Moderate zoom on 15m: day numbers + 12:00 noon marks midway between days.
 * 3. High zoom on 15m: 2-hour increments (10:00, 12:00, 14:00).
 * 4. Month rollover: month name (e.g. Oct) on month change.
 * 5. Future dates: smooth extrapolation across empty right margin skipping weekends.
 */
import { describe, expect, it } from 'vitest';
import { DataLayer } from '../src/model/data-layer';
import { TimeScale } from '../src/scale/time-scale';
import { drawTimeAxis, type PlotLayout } from '../src/render/axis';
import { RecordingContext } from './helpers/fake-ctx';
import { SessionCalendar } from '../src/feed/instrument';
import type { Bar } from '../src/model/bar';

const ist = (wall: string): number => Date.parse(`${wall}+05:30`) / 1000;
const bar = (time: number): Bar => ({ time, open: 100, high: 101, low: 99, close: 100 });

const LAYOUT: PlotLayout = {
  plotWidth: 1200,
  plotHeight: 400,
  priceAxisWidth: 56,
  timeAxisHeight: 24,
  plotLeft: 0,
};

function generate15mDayBars(dateStr: string): Bar[] {
  const bars: Bar[] = [];
  const start = ist(`${dateStr}T09:15:00`);
  const end = ist(`${dateStr}T15:15:00`);
  for (let t = start; t <= end; t += 15 * 60) {
    bars.push(bar(t));
  }
  return bars;
}

function drawAxis(
  data: Bar[],
  options: {
    barSpacing?: number;
    rightOffset?: number;
    calendar?: SessionCalendar;
    plotWidth?: number;
  } = {},
): string[] {
  const dl = new DataLayer();
  dl.setSeriesData(dl.createSeries(), data);
  const calendar = options.calendar ?? new SessionCalendar({
    timezone: 'Asia/Kolkata',
    sessions: ['0915-1530:23456'],
  });
  dl.setSessionCalendar(calendar);

  const width = options.plotWidth ?? LAYOUT.plotWidth;
  const ts = new TimeScale({
    barSpacing: options.barSpacing ?? 8,
    rightOffset: options.rightOffset ?? 0,
    futureDates: true,
  });
  ts.setWidth(width);
  ts.setBaseIndex(dl.baseIndex);

  const rec = new RecordingContext();
  drawTimeAxis(rec as unknown as CanvasRenderingContext2D, ts, dl, { ...LAYOUT, plotWidth: width }, 1);
  return rec.ops.filter((o) => o.type === 'fillText').map((o) => o.text ?? '');
}

describe('TradingView-style hierarchical time axis', () => {
  const dates = [
    '2026-10-06',
    '2026-10-07',
    '2026-10-08',
    '2026-10-09',
    '2026-10-12',
    '2026-10-13',
    '2026-10-14',
    '2026-10-15',
  ];
  const octBars = dates.flatMap(generate15mDayBars);

  it('renders only integer day numbers at low zoom on 15m charts (no clock marks)', () => {
    // 25 bars/day * 4px = 100px/day (< 180px)
    const labels = drawAxis(octBars, { barSpacing: 4 });

    // Day numbers must be present
    expect(labels).toContain('6');
    expect(labels).toContain('7');
    expect(labels).toContain('8');
    expect(labels).toContain('9');
    expect(labels).toContain('12');
    expect(labels).toContain('13');
    expect(labels).toContain('14');
    expect(labels).toContain('15');

    // No intraday clock times (noon or hours) should appear at low zoom
    expect(labels.some((l) => l.includes(':'))).toBe(false);
  });

  it('reveals 12:00 noon midway between days at moderate zoom (180px <= pixelsPerDay < 360px)', () => {
    // 25 bars/day * 9px = 225px/day
    const labels = drawAxis(octBars, { barSpacing: 9, plotWidth: 2000 });

    // Day numbers remain
    expect(labels).toContain('7');
    expect(labels).toContain('8');
    expect(labels).toContain('9');

    // Clean noon clock time 12:00 appears
    expect(labels).toContain('12:00');

    // Other round hours (10:00, 14:00) should still be suppressed at moderate zoom
    expect(labels).not.toContain('10:00');
    expect(labels).not.toContain('14:00');
    expect(labels).not.toContain('10:30');
    expect(labels).not.toContain('12:15');
  });

  it('reveals 2-hour increments (10:00, 12:00, 14:00) at high zoom (pixelsPerDay >= 360px)', () => {
    // 25 bars/day * 18px = 450px/day
    const labels = drawAxis(octBars, { barSpacing: 18 });

    // Round 2-hour clock times appear
    expect(labels).toContain('12:00');
    expect(labels).toContain('10:00');
    expect(labels).toContain('14:00');

    // Arbitrary stride offsets never appear
    expect(labels).not.toContain('10:30');
    expect(labels).not.toContain('12:15');
    expect(labels).not.toContain('14:45');
  });

  it('shows month name on month turnover instead of day number', () => {
    const sepBars = ['2026-09-29', '2026-09-30'].flatMap(generate15mDayBars);
    const octBarsSubset = ['2026-10-01', '2026-10-02'].flatMap(generate15mDayBars);
    const combined = [...sepBars, ...octBarsSubset];

    const labels = drawAxis(combined, { barSpacing: 4 });
    expect(labels).toContain('Oct');
    expect(labels).toContain('29');
    expect(labels).toContain('30');
    expect(labels).toContain('2');
  });

  it('projects future day numbers smoothly into empty space past latest data', () => {
    // Friday bars ending 2026-10-09 15:15
    const fridayBars = generate15mDayBars('2026-10-09');
    const nse = new SessionCalendar({
      timezone: 'Asia/Kolkata',
      sessions: ['0915-1530:23456'],
    });

    // Provide 60 bars of empty space into the future (~2.4 trading days: Monday 12th & Tuesday 13th)
    const labels = drawAxis(fridayBars, {
      barSpacing: 5,
      rightOffset: 60,
      calendar: nse,
      plotWidth: 800,
    });

    // Monday (12) and Tuesday (13) must appear in the projected empty area
    expect(labels).toContain('9');
    expect(labels).toContain('12');
    expect(labels).toContain('13');

    // Weekend (10, 11) must not appear
    expect(labels).not.toContain('10');
    expect(labels).not.toContain('11');
  });
});
