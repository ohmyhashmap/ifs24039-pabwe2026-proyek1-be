export type SafeWindow = {
  startIndex: number;
  endIndex: number;
  averagePm25: number;
};

export function findSafeWindow(
  times: readonly string[],
  pm25: readonly (number | null)[]
): SafeWindow {
  const windowSize = 3;
  let bestStartIndex = -1;
  let lowestSum = Infinity;

  for (let index = 0; index <= pm25.length - windowSize; index++) {
    const values = pm25.slice(index, index + windowSize);
    if (
      values.length !== windowSize ||
      values.some((value) => value === null || !Number.isFinite(value))
    )
      continue;

    const currentSum = values.reduce<number>(
      (sum, value) => sum + (value ?? 0),
      0
    );
    if (currentSum < lowestSum) {
      lowestSum = currentSum;
      bestStartIndex = index;
    }
  }

  if (bestStartIndex < 0 || times.length < bestStartIndex + windowSize) {
    throw new Error(
      'Data PM2.5 tidak memiliki rentang waktu tiga jam yang valid'
    );
  }

  const validTimes = times.slice(bestStartIndex, bestStartIndex + windowSize);
  if (validTimes.some((time) => !Number.isFinite(Date.parse(time)))) {
    throw new Error('Data waktu Open-Meteo tidak valid');
  }

  return {
    startIndex: bestStartIndex,
    endIndex: bestStartIndex + windowSize - 1,
    averagePm25: lowestSum / windowSize
  };
}
