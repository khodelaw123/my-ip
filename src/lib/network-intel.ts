export type IntelData = {
  ipv4: string | null;
  ipv6: string | null;
  isp: string | null;
  city: string | null;
  country: string | null;
  lat: number | null;
  lon: number | null;
};

export const EMPTY_INTEL: IntelData = {
  ipv4: null,
  ipv6: null,
  isp: null,
  city: null,
  country: null,
  lat: null,
  lon: null,
};

const GENERIC_TEXT_VALUES = new Set([
  "unknown",
  "n/a",
  "na",
  "none",
  "null",
  "undefined",
  "-",
  "نامشخص",
]);

const COUNTRY_CODE_TO_NAME: Record<string, string> = {
  IR: "Iran",
  US: "United States",
  GB: "United Kingdom",
  DE: "Germany",
  FR: "France",
  TR: "Turkey",
  AE: "United Arab Emirates",
  IQ: "Iraq",
  RU: "Russia",
  NL: "Netherlands",
  CA: "Canada",
  AU: "Australia",
  JP: "Japan",
  CN: "China",
  IN: "India",
};

export function parseCoordinate(value?: number | string | null): number | null {
  if (value === undefined || value === null) return null;
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

export function isValidIPv4(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  return parts.every((part) => {
    if (!/^\d+$/.test(part)) return false;
    const num = Number(part);
    return num >= 0 && num <= 255;
  });
}

export function isValidIPv6(value: string): boolean {
  if (!value.includes(":")) return false;
  if (!/^[0-9a-fA-F:]+$/.test(value)) return false;
  if (value.includes(":::")) return false;
  const parts = value.split(":");
  return parts.length <= 8;
}

export function detectIpFamily(value?: string | null): "IPv4" | "IPv6" | null {
  if (!value) return null;
  const ip = value.trim();
  if (!ip) return null;
  if (isValidIPv4(ip)) return "IPv4";
  if (isValidIPv6(ip)) return "IPv6";
  return null;
}

export function isMeaningfulText(value?: string | null): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  return !GENERIC_TEXT_VALUES.has(trimmed.toLowerCase());
}

export function normalizeCountry(value?: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) {
    return COUNTRY_CODE_TO_NAME[upper] ?? upper;
  }
  return trimmed;
}

export function parseLocPair(value?: string | null): { lat: number | null; lon: number | null } {
  if (!value) return { lat: null, lon: null };
  const [rawLat, rawLon] = value.split(",");
  return {
    lat: parseCoordinate(rawLat?.trim()),
    lon: parseCoordinate(rawLon?.trim()),
  };
}

function chooseBetterIsp(current: string | null, next: string | null): string | null {
  const currentOk = isMeaningfulText(current);
  const nextOk = isMeaningfulText(next);
  if (!currentOk && nextOk) return next?.trim() ?? null;
  if (currentOk && !nextOk) return current?.trim() ?? null;
  if (currentOk && nextOk) {
    return (next?.trim().length ?? 0) > (current?.trim().length ?? 0)
      ? next?.trim() ?? null
      : current?.trim() ?? null;
  }
  return current?.trim() || next?.trim() || null;
}

export function mergeIntel(primary: IntelData, incoming: Partial<IntelData>): IntelData {
  const next: IntelData = { ...primary };

  if (!next.ipv4 && incoming.ipv4 && detectIpFamily(incoming.ipv4) === "IPv4") {
    next.ipv4 = incoming.ipv4.trim();
  }
  if (!next.ipv6 && incoming.ipv6 && detectIpFamily(incoming.ipv6) === "IPv6") {
    next.ipv6 = incoming.ipv6.trim();
  }

  if (!next.city && isMeaningfulText(incoming.city)) {
    next.city = incoming.city?.trim() ?? null;
  }

  const normalizedCountry = normalizeCountry(incoming.country);
  if (!next.country && normalizedCountry) {
    next.country = normalizedCountry;
  }

  next.isp = chooseBetterIsp(next.isp, incoming.isp ?? null);

  const lat = parseCoordinate(incoming.lat);
  const lon = parseCoordinate(incoming.lon);
  if (next.lat === null && next.lon === null && lat !== null && lon !== null) {
    next.lat = lat;
    next.lon = lon;
  }

  return next;
}

export function hasAtLeastOneIp(data: IntelData): boolean {
  return Boolean(data.ipv4 || data.ipv6);
}

export function isGeoWeak(data: IntelData): boolean {
  const hasGeoText =
    isMeaningfulText(data.isp) || isMeaningfulText(data.city) || isMeaningfulText(data.country);
  const hasCoords = data.lat !== null && data.lon !== null;
  return !hasGeoText && !hasCoords;
}

export function shouldStopEarly(data: IntelData): boolean {
  const hasBothIps = Boolean(data.ipv4 && data.ipv6);
  const hasGeo = isMeaningfulText(data.isp) || isMeaningfulText(data.country);
  return hasBothIps && hasGeo;
}

export function redactIpForDiagnostics(ip?: string | null): string {
  if (!ip) return "missing";
  const family = detectIpFamily(ip);
  if (family === "IPv4") {
    const parts = ip.split(".");
    return `${parts[0]}.${parts[1]}.${parts[2]}.x`;
  }
  if (family === "IPv6") {
    const parts = ip.split(":").filter(Boolean);
    if (parts.length < 2) return "xxxx::";
    return `${parts[0]}:${parts[1]}::xxxx`;
  }
  return "invalid";
}
