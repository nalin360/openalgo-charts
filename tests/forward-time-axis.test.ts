/**
 * Forward space & future dates on the horizontal X-axis.
 * Verifies that empty space after the latest bar shows extrapolated future dates
 * and tick marks so the chart doesn't touch the right edge.
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
  plotWidth: 800,
  plotHeight: 378,
  priceAxisWidth: 56,
  timeAxisHeight: 22,
  plotLeft: 0,
};

function drawAxis(
  data: Bar[],
  options: {
    barSpacing?: number;
    rightOffset?: number;
    futureDates?: boolean;
    calendar?: SessionCalendar;
  } = {},
): { labels: string[]; rec: RecordingContext } {
  const dl = new DataLayer();
  dl.setSeriesData(dl.createSeries(), data);
  if (options.calendar) dl.setSessionCalendar(options.calendar);

  const barSpacing = options.barSpacing ?? 80;
  const ts = new TimeScale({
    barSpacing,
    rightOffset: options.rightOffset ?? 4,
    futureDates: options.futureDates,
  });
  ts.setWidth(LAYOUT.plotWidth);
  ts.setBaseIndex(dl.baseIndex);

  const rec = new RecordingContext();
  drawTimeAxis(rec as unknown as CanvasRenderingContext2D, ts, dl, LAYOUT, 1);
  const labels = rec.ops.filter((o) => o.type === 'fillText').map((o) => o.text ?? '');
  return { labels, rec };
}

describe('forward space and future dates on horizontal X-axis', () => {
  it('renders future dates across the empty right margin past baseIndex', () => {
    // 5 daily bars ending on Thursday 2026-02-05
    const dates = ['2026-02-01', '2026-02-02', '2026-02-03', '2026-02-04', '2026-02-05'];
    const bars = dates.map((d) => bar(ist(`${d}T00:00:00`)));

    // With 4 bars of right offset at barSpacing 80 (stride = 1), future indices 5..8 should have labels
    const { labels } = drawAxis(bars, { rightOffset: 4, barSpacing: 80 });

    // Should include the existing dates plus future dates (06 Feb, 07 Feb, 08 Feb, 09 Feb)
    expect(labels).toContain('06 Feb');
    expect(labels).toContain('07 Feb');
    expect(labels).toContain('08 Feb');
    expect(labels).toContain('09 Feb');
  });

  it('skips future labels when futureDates is explicitly set to false', () => {
    const dates = ['2026-02-01', '2026-02-02', '2026-02-03', '2026-02-04', '2026-02-05'];
    const bars = dates.map((d) => bar(ist(`${d}T00:00:00`)));

    const { labels } = drawAxis(bars, { rightOffset: 4, barSpacing: 80, futureDates: false });

    // Should only contain labels up to 05 Feb
    expect(labels).toContain('05 Feb');
    expect(labels).not.toContain('06 Feb');
    expect(labels).not.toContain('07 Feb');
  });

  it('respects session calendar in future space (skipping weekends/nights)', () => {
    // Friday cash session close at 15:25
    const MIN = 60;
    const fridayBars: Bar[] = [];
    for (let t = ist('2026-02-06T09:15:00'); t <= ist('2026-02-06T15:25:00'); t += 15 * MIN) {
      fridayBars.push(bar(t));
    }

    const nse = new SessionCalendar({
      timezone: 'Asia/Kolkata',
      sessions: ['0915-1530:23456'],
    });

    const { labels } = drawAxis(fridayBars, {
      rightOffset: 6,
      barSpacing: 80,
      calendar: nse,
    });

    // The next bar after Friday 15:25 is Monday 09:15 ('09 Feb')
    expect(labels).toContain('09 Feb');
    // It should not draw Saturday (07 Feb) or Sunday (08 Feb)
    expect(labels).not.toContain('07 Feb');
    expect(labels).not.toContain('08 Feb');
  });

  it('TimeScale.applyOptions dynamically updates rightOffset and futureDates', () => {
    const ts = new TimeScale({ rightOffset: 4, futureDates: true });
    expect(ts.rightOffset).toBe(4);
    expect(ts.futureDates).toBe(true);

    ts.applyOptions({ rightOffset: 12, futureDates: false });
    expect(ts.rightOffset).toBe(12);
    expect(ts.futureDates).toBe(false);

    ts.setOptions({ rightOffset: 8, futureDates: true });
    expect(ts.rightOffset).toBe(8);
    expect(ts.futureDates).toBe(true);
  });
});
