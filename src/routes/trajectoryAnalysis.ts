export type Coordinates = { lat: number; lon: number };

export function getDestination(
  lat: number,
  lon: number,
  bearing: number,
  distanceKm: number
): Coordinates {
  if (![lat, lon, bearing, distanceKm].every(Number.isFinite))
    return { lat, lon };

  const earthRadiusKm = 6371;
  const angularDistance = distanceKm / earthRadiusKm;
  const bearingRadians = (bearing * Math.PI) / 180;
  const latitudeRadians = (lat * Math.PI) / 180;
  const longitudeRadians = (lon * Math.PI) / 180;
  const destinationLatitude = Math.asin(
    Math.sin(latitudeRadians) * Math.cos(angularDistance) +
      Math.cos(latitudeRadians) *
        Math.sin(angularDistance) *
        Math.cos(bearingRadians)
  );
  const destinationLongitude =
    longitudeRadians +
    Math.atan2(
      Math.sin(bearingRadians) *
        Math.sin(angularDistance) *
        Math.cos(latitudeRadians),
      Math.cos(angularDistance) -
        Math.sin(latitudeRadians) * Math.sin(destinationLatitude)
    );

  return {
    lat: (destinationLatitude * 180) / Math.PI,
    lon: (destinationLongitude * 180) / Math.PI
  };
}

export function buildTrajectory(
  origin: Coordinates,
  windSpeeds: readonly (number | null | undefined)[],
  windDirections: readonly (number | null | undefined)[]
): [number, number][] {
  const points: [number, number][] = [[origin.lon, origin.lat]];
  let current = origin;

  for (let step = 0; step < 4; step++) {
    const index = step * 6;
    const speedKmh = windSpeeds[index] ?? 0;
    const windDirection = windDirections[index] ?? 0;
    if (speedKmh === 0) continue;

    const nextPoint = getDestination(
      current.lat,
      current.lon,
      (windDirection + 180) % 360,
      speedKmh * 6
    );
    if (!Number.isNaN(nextPoint.lat) && !Number.isNaN(nextPoint.lon)) {
      points.push([nextPoint.lon, nextPoint.lat]);
      current = nextPoint;
    }
  }

  return points;
}
