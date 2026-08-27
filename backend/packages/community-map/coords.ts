// Parse a "lat,lng" string into GeoJSON [lng, lat] order (Leaflet markers swap back to [lat,lng]).
export function parseCoords(raw: string | null | undefined): [number, number] | null {
  if (!raw || typeof raw !== 'string') return null;
  const parts = raw.split(',').map((s) => parseFloat(s.trim()));
  if (parts.length !== 2 || parts.some((n) => Number.isNaN(n))) return null;
  const [lat, lng] = parts as [number, number];
  return [lng, lat];
}
