import { describe, expect, it } from 'vitest';
import { DataLayer } from '../src/model/data-layer';
import { TimeScale } from '../src/scale/time-scale';
import { PriceScale } from '../src/scale/price-scale';
import { computeVisibleTimeMarks, drawTimeAxis, priceTickCount, type PlotLayout } from '../src/render/axis';
import { computeGridLines, drawGrid, resolveGridStyle } from '../src/render/grid';
import { RecordingContext } from './helpers/fake-ctx';
import { SessionCalendar } from '../src/feed/instrument';
import { darkTheme } from '../src/theme';
import type { Bar } from '../src/model/bar';

const ist = (wall: string): number => Date.parse(`${wall}+05:30`) / 1000;
const bar = (time: number): Bar => ({ time, open: 100, high: 105, low: 95, close: 102 });

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

describe('Dynamic timeframe-aware grid', () => {
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

  it('aligns vertical grid lines with visible time axis tick marks and 12:00 times', () => {
    const dl = new DataLayer();
    dl.setSeriesData(dl.createSeries(), octBars);
    dl.setSessionCalendar(new SessionCalendar({
      timezone: 'Asia/Kolkata',
      sessions: ['0915-1530:23456'],
    }));

    const ts = new TimeScale({
      barSpacing: 9,
      rightOffset: 0,
      futureDates: true,
    });
    ts.setWidth(LAYOUT.plotWidth);
    ts.setBaseIndex(dl.baseIndex);

    // Compute marks via computeVisibleTimeMarks
    const marks = computeVisibleTimeMarks(ts, dl, LAYOUT.plotWidth, 1);
    expect(marks.length).toBeGreaterThan(0);

    const labels = marks.map((m) => m.text);
    // Should include day numbers and noon marks at moderate zoom
    expect(labels).toContain('12:00');
    expect(labels).toContain('14');
    expect(labels).toContain('15');

    // Grid vertical lines computed from marks
    const gridLines = computeGridLines(
      LAYOUT.plotWidth,
      LAYOUT.plotHeight,
      { spacing: 60, vertLines: true, horzLines: true },
      { verticals: marks.map((m) => m.x) },
    );

    // Every vertical line corresponds to a visible mark within plot bounds
    expect(gridLines.verticals.length).toBe(marks.filter((m) => m.x > 0 && m.x < LAYOUT.plotWidth).length);

    // Verify coordinates match timeScale.indexToX exactly
    for (let i = 0; i < gridLines.verticals.length; i++) {
      const mark = marks.filter((m) => m.x > 0 && m.x < LAYOUT.plotWidth)[i]!;
      expect(gridLines.verticals[i]).toBe(mark.x);
    }
  });

  it('aligns horizontal grid lines with price scale ticks', () => {
    const scale = new PriceScale();
    scale.setHeight(LAYOUT.plotHeight);
    scale.setFixedRange({ min: 100, max: 200 });

    const ticks = scale.ticks(priceTickCount(LAYOUT.plotHeight, 32));
    expect(ticks.length).toBeGreaterThan(2);

    const expectedY = ticks
      .map((p) => scale.priceToY(p))
      .filter((y) => y > 0 && y < LAYOUT.plotHeight);

    const gridLines = computeGridLines(
      LAYOUT.plotWidth,
      LAYOUT.plotHeight,
      { spacing: 60, vertLines: true, horzLines: true },
      { horizontals: expectedY },
    );

    expect(gridLines.horizontals).toEqual(expectedY);
  });

  it('draws vertical grid lines that pass through time axis label positions', () => {
    const dl = new DataLayer();
    dl.setSeriesData(dl.createSeries(), octBars);
    dl.setSessionCalendar(new SessionCalendar({
      timezone: 'Asia/Kolkata',
      sessions: ['0915-1530:23456'],
    }));

    const ts = new TimeScale({ barSpacing: 9, rightOffset: 0, futureDates: true });
    ts.setWidth(LAYOUT.plotWidth);
    ts.setBaseIndex(dl.baseIndex);

    const axisRec = new RecordingContext();
    drawTimeAxis(axisRec as unknown as CanvasRenderingContext2D, ts, dl, LAYOUT, 1);
    const labelOps = axisRec.ops.filter((o) => o.type === 'fillText');
    const labelXPositions = labelOps.map((o) => o.args[0]);

    const marks = computeVisibleTimeMarks(ts, dl, LAYOUT.plotWidth, 1, undefined, undefined, (t) => axisRec.measureText(t).width);
    const gridRec = new RecordingContext();
    const gridLines = computeGridLines(
      LAYOUT.plotWidth,
      LAYOUT.plotHeight,
      { spacing: 60, vertLines: true, horzLines: false },
      { verticals: marks.map((m) => m.x) },
    );
    drawGrid(
      gridRec as unknown as CanvasRenderingContext2D,
      gridLines,
      LAYOUT.plotWidth,
      LAYOUT.plotHeight,
      1,
      resolveGridStyle(darkTheme, undefined, 1),
    );

    // Each vertical line stroked on the grid has a moveTo(x, 0) and lineTo(x, h)
    const gridMoveTos = gridRec.ops.filter((o) => o.type === 'moveTo');
    const gridXPositions = gridMoveTos.map((o) => o.args[0]);

    // Grid vertical lines and time axis labels have identical x-coordinates
    expect(gridXPositions).toEqual(labelXPositions);
  });
});
