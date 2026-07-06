import { IS_DEV, PAGINATION_PROFILING } from '../../../env';
import { Logger } from '../../../logger';

const logger = new Logger('PaginationProfiler');
const SAMPLE_LIMIT = 60;
const DEFAULT_SLOW_RUN_THRESHOLD_MS = 12;

export interface PaginationRunMetrics {
  timestamp: string;
  totalMs: number;
  collectBlocksMs: number;
  calculateLayoutMs: number;
  buildDecorationsMs: number;
  dispatchMs: number;
  domMeasurementMs: number;
  pretextMeasurementMs: number;
  paragraphPaginationMs: number;
  blocks: number;
  breakCount: number;
  pageCount: number;
  changed: boolean;
  followUpRequested: boolean;
  previousBreakCount: number;
  previousPageCount: number;
  overflowingBlockCount: number;
  overflowingParagraphCount: number;
  paragraphMeasurementCount: number;
  paragraphPaginationCount: number;
  measuredLineCount: number;
  domMeasurementAttemptCount: number;
  domMeasurementSuccessCount: number;
  domTextNodeCount: number;
  domFragmentCount: number;
  domBinarySearchStepCount: number;
  pretextMeasurementAttemptCount: number;
  pretextMeasurementSuccessCount: number;
}

interface PaginationProfileSnapshot {
  enabled: boolean;
  slowRunThresholdMs: number;
  totalRuns: number;
  totalMs: number;
  averageMs: number;
  maxMs: number;
  averages: {
    collectBlocksMs: number;
    calculateLayoutMs: number;
    buildDecorationsMs: number;
    dispatchMs: number;
    domMeasurementMs: number;
    pretextMeasurementMs: number;
    paragraphPaginationMs: number;
    blocks: number;
    breakCount: number;
    measuredLineCount: number;
  };
  totals: {
    overflowingBlockCount: number;
    overflowingParagraphCount: number;
    paragraphMeasurementCount: number;
    paragraphPaginationCount: number;
    domMeasurementAttemptCount: number;
    domMeasurementSuccessCount: number;
    domTextNodeCount: number;
    domFragmentCount: number;
    domBinarySearchStepCount: number;
    pretextMeasurementAttemptCount: number;
    pretextMeasurementSuccessCount: number;
  };
  recentSamples: PaginationRunMetrics[];
}

interface PaginationProfileController {
  enabled: boolean;
  slowRunThresholdMs: number;
  reset: () => void;
  snapshot: () => PaginationProfileSnapshot;
  printSummary: () => PaginationProfileSnapshot;
}

declare global {
  interface Window {
    __MYELIN_PAGINATION_PROFILE__?: PaginationProfileController;
  }
}

const zeroAverages = {
  collectBlocksMs: 0,
  calculateLayoutMs: 0,
  buildDecorationsMs: 0,
  dispatchMs: 0,
  domMeasurementMs: 0,
  pretextMeasurementMs: 0,
  paragraphPaginationMs: 0,
  blocks: 0,
  breakCount: 0,
  measuredLineCount: 0,
};

const zeroTotals = {
  overflowingBlockCount: 0,
  overflowingParagraphCount: 0,
  paragraphMeasurementCount: 0,
  paragraphPaginationCount: 0,
  domMeasurementAttemptCount: 0,
  domMeasurementSuccessCount: 0,
  domTextNodeCount: 0,
  domFragmentCount: 0,
  domBinarySearchStepCount: 0,
  pretextMeasurementAttemptCount: 0,
  pretextMeasurementSuccessCount: 0,
};

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function createEmptyMetrics(
  previousBreakCount: number,
  previousPageCount: number,
  followUpRequested: boolean,
): PaginationRunMetrics {
  return {
    timestamp: new Date().toISOString(),
    totalMs: 0,
    collectBlocksMs: 0,
    calculateLayoutMs: 0,
    buildDecorationsMs: 0,
    dispatchMs: 0,
    domMeasurementMs: 0,
    pretextMeasurementMs: 0,
    paragraphPaginationMs: 0,
    blocks: 0,
    breakCount: 0,
    pageCount: previousPageCount,
    changed: false,
    followUpRequested,
    previousBreakCount,
    previousPageCount,
    overflowingBlockCount: 0,
    overflowingParagraphCount: 0,
    paragraphMeasurementCount: 0,
    paragraphPaginationCount: 0,
    measuredLineCount: 0,
    domMeasurementAttemptCount: 0,
    domMeasurementSuccessCount: 0,
    domTextNodeCount: 0,
    domFragmentCount: 0,
    domBinarySearchStepCount: 0,
    pretextMeasurementAttemptCount: 0,
    pretextMeasurementSuccessCount: 0,
  };
}

class PaginationRunProfiler {
  public readonly metrics: PaginationRunMetrics;
  private readonly startedAt = performance.now();

  public constructor(
    private readonly owner: PaginationProfiler,
    previousBreakCount: number,
    previousPageCount: number,
    followUpRequested: boolean,
  ) {
    this.metrics = createEmptyMetrics(
      previousBreakCount,
      previousPageCount,
      followUpRequested,
    );
  }

  public finish(): void {
    this.metrics.totalMs = performance.now() - this.startedAt;
    this.owner.record(this.metrics);
  }
}

class PaginationProfiler {
  private enabled = PAGINATION_PROFILING;
  private slowRunThresholdMs = DEFAULT_SLOW_RUN_THRESHOLD_MS;
  private totalRuns = 0;
  private totalMs = 0;
  private maxMs = 0;
  private readonly recentSamples: PaginationRunMetrics[] = [];

  public constructor() {
    this.installController();
  }

  public startRun(
    previousBreakCount: number,
    previousPageCount: number,
    followUpRequested: boolean,
  ): PaginationRunProfiler | null {
    if (!this.enabled || typeof performance === 'undefined') {
      return null;
    }
    return new PaginationRunProfiler(
      this,
      previousBreakCount,
      previousPageCount,
      followUpRequested,
    );
  }

  public record(sample: PaginationRunMetrics): void {
    this.totalRuns++;
    this.totalMs += sample.totalMs;
    this.maxMs = Math.max(this.maxMs, sample.totalMs);
    this.recentSamples.push({ ...sample });
    if (this.recentSamples.length > SAMPLE_LIMIT) {
      this.recentSamples.shift();
    }

    if (sample.totalMs >= this.slowRunThresholdMs) {
      logger.debug('Slow pagination run', {
        totalMs: round2(sample.totalMs),
        blocks: sample.blocks,
        breaks: sample.breakCount,
        pageCount: sample.pageCount,
        changed: sample.changed,
        collectBlocksMs: round2(sample.collectBlocksMs),
        calculateLayoutMs: round2(sample.calculateLayoutMs),
        domMeasurementMs: round2(sample.domMeasurementMs),
        pretextMeasurementMs: round2(sample.pretextMeasurementMs),
        paragraphPaginationMs: round2(sample.paragraphPaginationMs),
        measuredLineCount: sample.measuredLineCount,
        domMeasurementAttemptCount: sample.domMeasurementAttemptCount,
        domMeasurementSuccessCount: sample.domMeasurementSuccessCount,
        domTextNodeCount: sample.domTextNodeCount,
        domFragmentCount: sample.domFragmentCount,
        domBinarySearchStepCount: sample.domBinarySearchStepCount,
      });
    }
  }

  public reset(): void {
    this.totalRuns = 0;
    this.totalMs = 0;
    this.maxMs = 0;
    this.recentSamples.length = 0;
  }

  public snapshot(): PaginationProfileSnapshot {
    if (this.totalRuns === 0) {
      return {
        enabled: this.enabled,
        slowRunThresholdMs: this.slowRunThresholdMs,
        totalRuns: 0,
        totalMs: 0,
        averageMs: 0,
        maxMs: 0,
        averages: zeroAverages,
        totals: zeroTotals,
        recentSamples: [],
      };
    }

    const totals = { ...zeroTotals };
    const sums = { ...zeroAverages };

    for (const sample of this.recentSamples) {
      sums.collectBlocksMs += sample.collectBlocksMs;
      sums.calculateLayoutMs += sample.calculateLayoutMs;
      sums.buildDecorationsMs += sample.buildDecorationsMs;
      sums.dispatchMs += sample.dispatchMs;
      sums.domMeasurementMs += sample.domMeasurementMs;
      sums.pretextMeasurementMs += sample.pretextMeasurementMs;
      sums.paragraphPaginationMs += sample.paragraphPaginationMs;
      sums.blocks += sample.blocks;
      sums.breakCount += sample.breakCount;
      sums.measuredLineCount += sample.measuredLineCount;

      totals.overflowingBlockCount += sample.overflowingBlockCount;
      totals.overflowingParagraphCount += sample.overflowingParagraphCount;
      totals.paragraphMeasurementCount += sample.paragraphMeasurementCount;
      totals.paragraphPaginationCount += sample.paragraphPaginationCount;
      totals.domMeasurementAttemptCount += sample.domMeasurementAttemptCount;
      totals.domMeasurementSuccessCount += sample.domMeasurementSuccessCount;
      totals.domTextNodeCount += sample.domTextNodeCount;
      totals.domFragmentCount += sample.domFragmentCount;
      totals.domBinarySearchStepCount += sample.domBinarySearchStepCount;
      totals.pretextMeasurementAttemptCount +=
        sample.pretextMeasurementAttemptCount;
      totals.pretextMeasurementSuccessCount +=
        sample.pretextMeasurementSuccessCount;
    }

    const divisor = this.recentSamples.length;

    return {
      enabled: this.enabled,
      slowRunThresholdMs: this.slowRunThresholdMs,
      totalRuns: this.totalRuns,
      totalMs: round2(this.totalMs),
      averageMs: round2(this.totalMs / this.totalRuns),
      maxMs: round2(this.maxMs),
      averages: {
        collectBlocksMs: round2(sums.collectBlocksMs / divisor),
        calculateLayoutMs: round2(sums.calculateLayoutMs / divisor),
        buildDecorationsMs: round2(sums.buildDecorationsMs / divisor),
        dispatchMs: round2(sums.dispatchMs / divisor),
        domMeasurementMs: round2(sums.domMeasurementMs / divisor),
        pretextMeasurementMs: round2(sums.pretextMeasurementMs / divisor),
        paragraphPaginationMs: round2(sums.paragraphPaginationMs / divisor),
        blocks: round2(sums.blocks / divisor),
        breakCount: round2(sums.breakCount / divisor),
        measuredLineCount: round2(sums.measuredLineCount / divisor),
      },
      totals,
      recentSamples: this.recentSamples.map((sample) => ({ ...sample })),
    };
  }

  public printSummary(): PaginationProfileSnapshot {
    const snapshot = this.snapshot();
    console.groupCollapsed(
      `[PaginationProfiler] ${snapshot.totalRuns} runs avg ${snapshot.averageMs}ms max ${snapshot.maxMs}ms`,
    );
    console.table([
      {
        averageMs: snapshot.averageMs,
        maxMs: snapshot.maxMs,
        avgCollectBlocksMs: snapshot.averages.collectBlocksMs,
        avgCalculateLayoutMs: snapshot.averages.calculateLayoutMs,
        avgDomMeasurementMs: snapshot.averages.domMeasurementMs,
        avgPretextMeasurementMs: snapshot.averages.pretextMeasurementMs,
        avgParagraphPaginationMs: snapshot.averages.paragraphPaginationMs,
        avgBlocks: snapshot.averages.blocks,
        avgBreaks: snapshot.averages.breakCount,
        avgMeasuredLines: snapshot.averages.measuredLineCount,
        domAttempts: snapshot.totals.domMeasurementAttemptCount,
        domSuccesses: snapshot.totals.domMeasurementSuccessCount,
        domTextNodes: snapshot.totals.domTextNodeCount,
        domFragments: snapshot.totals.domFragmentCount,
        domBinarySearchSteps: snapshot.totals.domBinarySearchStepCount,
        pretextAttempts: snapshot.totals.pretextMeasurementAttemptCount,
        pretextSuccesses: snapshot.totals.pretextMeasurementSuccessCount,
      },
    ]);
    console.table(
      snapshot.recentSamples.map((sample) => ({
        timestamp: sample.timestamp,
        totalMs: round2(sample.totalMs),
        blocks: sample.blocks,
        breaks: sample.breakCount,
        pageCount: sample.pageCount,
        changed: sample.changed,
        followUpRequested: sample.followUpRequested,
        collectBlocksMs: round2(sample.collectBlocksMs),
        calculateLayoutMs: round2(sample.calculateLayoutMs),
        buildDecorationsMs: round2(sample.buildDecorationsMs),
        dispatchMs: round2(sample.dispatchMs),
        domMeasurementMs: round2(sample.domMeasurementMs),
        pretextMeasurementMs: round2(sample.pretextMeasurementMs),
        paragraphPaginationMs: round2(sample.paragraphPaginationMs),
        measuredLineCount: sample.measuredLineCount,
        domAttempts: sample.domMeasurementAttemptCount,
        domSuccesses: sample.domMeasurementSuccessCount,
        domTextNodes: sample.domTextNodeCount,
        domFragments: sample.domFragmentCount,
        domBinarySearchSteps: sample.domBinarySearchStepCount,
      })),
    );
    console.groupEnd();
    return snapshot;
  }

  private installController(): void {
    if (!IS_DEV && !PAGINATION_PROFILING) {
      return;
    }
    if (typeof window === 'undefined') {
      return;
    }
    if (window.__MYELIN_PAGINATION_PROFILE__) {
      return;
    }

    const controller: PaginationProfileController = {
      get enabled() {
        return paginationProfiler.enabled;
      },
      set enabled(value: boolean) {
        paginationProfiler.enabled = value;
      },
      get slowRunThresholdMs() {
        return paginationProfiler.slowRunThresholdMs;
      },
      set slowRunThresholdMs(value: number) {
        if (Number.isFinite(value) && value >= 0) {
          paginationProfiler.slowRunThresholdMs = value;
        }
      },
      reset: () => {
        paginationProfiler.reset();
      },
      snapshot: () => paginationProfiler.snapshot(),
      printSummary: () => paginationProfiler.printSummary(),
    };

    window.__MYELIN_PAGINATION_PROFILE__ = controller;
  }
}

export const paginationProfiler = new PaginationProfiler();
