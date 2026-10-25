const DECIMAL_COORDINATE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

export function parseCoordinates(
  latValue: string | undefined,
  lonValue: string | undefined,
  defaults?: { lat: number; lon: number }
): { lat: number; lon: number } {
  if (latValue === undefined && lonValue === undefined && defaults)
    return defaults;
  if (latValue === undefined || lonValue === undefined) {
    throw new Error('lat dan lon harus diberikan bersama-sama');
  }

  const lat = parseCoordinate(latValue, 'lat', -90, 90);
  const lon = parseCoordinate(lonValue, 'lon', -180, 180);
  return { lat, lon };
}

function parseCoordinate(
  value: string,
  name: string,
  min: number,
  max: number
): number {
  const normalized = value.trim();
  const coordinate = Number(normalized);
  if (
    !DECIMAL_COORDINATE.test(normalized) ||
    !Number.isFinite(coordinate) ||
    coordinate < min ||
    coordinate > max
  ) {
    throw new Error(`${name} harus berupa koordinat antara ${min} dan ${max}`);
  }
  return coordinate;
}
