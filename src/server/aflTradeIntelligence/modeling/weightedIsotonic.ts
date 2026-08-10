export interface AflTradeWeightedIsotonicPoint {
  pointId: string;
  x: number;
  value: number;
  weight: number;
}

export interface AflTradeWeightedIsotonicBlock {
  blockIndex: number;
  minimumX: number;
  maximumX: number;
  fittedValue: number;
  totalWeight: number;
  sourcePointCount: number;
  pointIds: string[];
}

export interface AflTradeWeightedIsotonicFit {
  direction: 'non_increasing';
  inputPointIds: string[];
  blocks: AflTradeWeightedIsotonicBlock[];
  fittedPoints: Array<{
    pointId: string;
    x: number;
    observedValue: number;
    fittedValue: number;
    weight: number;
    blockIndex: number;
  }>;
}

interface MutableBlock {
  minimumX: number;
  maximumX: number;
  weightedValueSum: number;
  totalWeight: number;
  sourcePoints: AflTradeWeightedIsotonicPoint[];
}

function normalizeNumber(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function blockValue(block: MutableBlock): number {
  return normalizeNumber(block.weightedValueSum / block.totalWeight);
}

function assertPoints(unparsedPoints: readonly AflTradeWeightedIsotonicPoint[]) {
  if (unparsedPoints.length === 0) {
    throw new RangeError('Weighted isotonic regression requires at least one point.');
  }
  const pointIds = new Set<string>();
  for (const point of unparsedPoints) {
    if (
      !point.pointId.trim() ||
      !Number.isFinite(point.x) ||
      !Number.isFinite(point.value) ||
      !Number.isFinite(point.weight) ||
      point.weight <= 0
    ) {
      throw new RangeError(
        'Weighted isotonic points require an identity, finite coordinates, and positive weight.'
      );
    }
    if (pointIds.has(point.pointId)) {
      throw new RangeError('Weighted isotonic point identities must be unique.');
    }
    pointIds.add(point.pointId);
  }
}

function aggregateByCoordinate(points: readonly AflTradeWeightedIsotonicPoint[]): MutableBlock[] {
  const sorted = points
    .map((point) => ({ ...point }))
    .sort((left, right) => left.x - right.x || left.pointId.localeCompare(right.pointId));
  const blocks: MutableBlock[] = [];
  for (const point of sorted) {
    const previous = blocks.at(-1);
    if (previous?.maximumX === point.x) {
      previous.weightedValueSum += point.value * point.weight;
      previous.totalWeight += point.weight;
      previous.sourcePoints.push(point);
      continue;
    }
    blocks.push({
      minimumX: point.x,
      maximumX: point.x,
      weightedValueSum: point.value * point.weight,
      totalWeight: point.weight,
      sourcePoints: [point],
    });
  }
  return blocks;
}

function mergeAdjacent(left: MutableBlock, right: MutableBlock): MutableBlock {
  return {
    minimumX: left.minimumX,
    maximumX: right.maximumX,
    weightedValueSum: left.weightedValueSum + right.weightedValueSum,
    totalWeight: left.totalWeight + right.totalWeight,
    sourcePoints: [...left.sourcePoints, ...right.sourcePoints],
  };
}

export function fitAflTradeWeightedNonIncreasingIsotonic(
  unparsedPoints: readonly AflTradeWeightedIsotonicPoint[]
): AflTradeWeightedIsotonicFit {
  assertPoints(unparsedPoints);
  const pooled: MutableBlock[] = [];
  for (const coordinateBlock of aggregateByCoordinate(unparsedPoints)) {
    pooled.push(coordinateBlock);
    while (
      pooled.length >= 2 &&
      blockValue(pooled[pooled.length - 2]) < blockValue(pooled[pooled.length - 1])
    ) {
      const right = pooled.pop()!;
      const left = pooled.pop()!;
      pooled.push(mergeAdjacent(left, right));
    }
  }

  const blocks = pooled.map((block, blockIndex): AflTradeWeightedIsotonicBlock => ({
    blockIndex,
    minimumX: block.minimumX,
    maximumX: block.maximumX,
    fittedValue: blockValue(block),
    totalWeight: normalizeNumber(block.totalWeight),
    sourcePointCount: block.sourcePoints.length,
    pointIds: block.sourcePoints.map(({ pointId }) => pointId).sort(),
  }));
  const blockByPointId = new Map(
    blocks.flatMap((block) => block.pointIds.map((pointId) => [pointId, block] as const))
  );
  const fittedPoints = unparsedPoints
    .map((point) => ({ ...point }))
    .sort((left, right) => left.x - right.x || left.pointId.localeCompare(right.pointId))
    .map((point) => {
      const block = blockByPointId.get(point.pointId)!;
      return {
        pointId: point.pointId,
        x: normalizeNumber(point.x),
        observedValue: normalizeNumber(point.value),
        fittedValue: block.fittedValue,
        weight: normalizeNumber(point.weight),
        blockIndex: block.blockIndex,
      };
    });

  return {
    direction: 'non_increasing',
    inputPointIds: [...unparsedPoints].map(({ pointId }) => pointId).sort(),
    blocks,
    fittedPoints,
  };
}
