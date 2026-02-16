import { NextResponse } from "next/server";
import {
  EMPTY_INTEL,
  detectIpFamily,
  hasAtLeastOneIp,
  mergeIntel,
  parseCoordinate,
  parseLocPair,
  shouldStopEarly,
  type IntelData,
} from "@/lib/network-intel";

type ProviderFormat = "json" | "text";

type Provider = {
  id: string;
  url: string;
  format: ProviderFormat;
};

type DiagnosticFailure = {
  source: string;
  reason: string;
};

type NetworkIntelResponse = {
  success: boolean;
  data: IntelData & { sourcesUsed: string[] };
  diagnostics?: {
    attempted: string[];
    failures: DiagnosticFailure[];
  };
};

const PROVIDER_TIMEOUT_MS = 3500;
const OVERALL_TIMEOUT_MS = 7000;
const CONCURRENCY_LIMIT = 4;

const PROVIDERS: Provider[] = [
  { id: "ipify-v4", url: "https://api4.ipify.org?format=json", format: "json" },
  { id: "ipify-v6", url: "https://api6.ipify.org?format=json", format: "json" },
  { id: "ipify-v64", url: "https://api64.ipify.org?format=json", format: "json" },
  { id: "ipify-generic", url: "https://api.ipify.org?format=json", format: "json" },
  { id: "ipsb-ip", url: "https://api.ip.sb/ip", format: "text" },
  { id: "ipsb64-ip", url: "https://api64.ip.sb/ip", format: "text" },
  { id: "icanhazip-v4", url: "https://ipv4.icanhazip.com", format: "text" },
  { id: "icanhazip-v6", url: "https://ipv6.icanhazip.com", format: "text" },
  { id: "ifconfig-ip", url: "https://ifconfig.me/ip", format: "text" },
  { id: "ipwhois-geo", url: "https://ipwho.is/", format: "json" },
  { id: "ipapi-geo", url: "https://ipapi.co/json/", format: "json" },
  { id: "ipinfo-geo", url: "https://ipinfo.io/json", format: "json" },
  { id: "freeipapi-geo", url: "https://freeipapi.com/api/json", format: "json" },
  { id: "ipsb-geo", url: "https://api.ip.sb/geoip", format: "json" },
];

function toRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  return value as Record<string, unknown>;
}

function pickString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function pickCoordinate(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    const coordinate = parseCoordinate(value as number | string | null);
    if (coordinate !== null) return coordinate;
  }
  return null;
}

function normalizeIpCandidate(value: string | null): Partial<IntelData> {
  if (!value) return {};
  const family = detectIpFamily(value);
  if (family === "IPv4") return { ipv4: value };
  if (family === "IPv6") return { ipv6: value };
  return {};
}

function parseProviderData(providerId: string, body: unknown): Partial<IntelData> {
  const record = toRecord(body);

  if (
    providerId === "ipify-v4" ||
    providerId === "ipify-v6" ||
    providerId === "ipify-v64" ||
    providerId === "ipify-generic"
  ) {
    return normalizeIpCandidate(pickString(record, ["ip"]));
  }

  if (providerId === "ipwhois-geo") {
    const connection = toRecord(record.connection);
    const ip = pickString(record, ["ip"]);
    const country = pickString(record, ["country", "country_name", "countryCode", "country_code"]);
    return {
      ...normalizeIpCandidate(ip),
      isp: pickString(connection, ["isp", "org", "organization"]),
      city: pickString(record, ["city"]),
      country,
      lat: pickCoordinate(record, ["latitude", "lat"]),
      lon: pickCoordinate(record, ["longitude", "lon"]),
    };
  }

  if (providerId === "ipapi-geo") {
    const ip = pickString(record, ["ip"]);
    const country = pickString(record, ["country_name", "country", "country_code"]);
    return {
      ...normalizeIpCandidate(ip),
      isp: pickString(record, ["org", "isp", "asn_org"]),
      city: pickString(record, ["city"]),
      country,
      lat: pickCoordinate(record, ["latitude", "lat"]),
      lon: pickCoordinate(record, ["longitude", "lon"]),
    };
  }

  if (providerId === "ipinfo-geo") {
    const ip = pickString(record, ["ip"]);
    const loc = parseLocPair(pickString(record, ["loc"]));
    return {
      ...normalizeIpCandidate(ip),
      isp: pickString(record, ["org"]),
      city: pickString(record, ["city"]),
      country: pickString(record, ["country"]),
      lat: loc.lat,
      lon: loc.lon,
    };
  }

  if (providerId === "freeipapi-geo") {
    const ip = pickString(record, ["ipAddress", "ip"]);
    return {
      ...normalizeIpCandidate(ip),
      isp: pickString(record, ["isp", "organizationName", "organization"]),
      city: pickString(record, ["cityName", "city"]),
      country: pickString(record, ["countryName", "countryCode", "country"]),
      lat: pickCoordinate(record, ["latitude", "lat"]),
      lon: pickCoordinate(record, ["longitude", "lon"]),
    };
  }

  if (providerId === "ipsb-geo") {
    const ip = pickString(record, ["ip"]);
    return {
      ...normalizeIpCandidate(ip),
      isp: pickString(record, ["isp", "organization", "asn_organization"]),
      city: pickString(record, ["city"]),
      country: pickString(record, ["country", "country_name", "country_code"]),
      lat: pickCoordinate(record, ["latitude", "lat"]),
      lon: pickCoordinate(record, ["longitude", "lon"]),
    };
  }

  return {};
}

function parseProviderText(providerId: string, text: string): Partial<IntelData> {
  const value = text.trim();
  if (!value) return {};
  if (
    providerId === "ipsb-ip" ||
    providerId === "ipsb64-ip" ||
    providerId === "icanhazip-v4" ||
    providerId === "icanhazip-v6" ||
    providerId === "ifconfig-ip"
  ) {
    return normalizeIpCandidate(value);
  }
  return {};
}

async function fetchProvider(
  provider: Provider,
  deadlineMs: number,
): Promise<{ partial: Partial<IntelData>; failure?: string }> {
  const remaining = deadlineMs - Date.now();
  if (remaining <= 0) return { partial: {}, failure: "overall-timeout" };

  const timeoutMs = Math.min(PROVIDER_TIMEOUT_MS, remaining);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(provider.url, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) return { partial: {}, failure: `http-${res.status}` };
    if (provider.format === "json") {
      const json = await res.json();
      return { partial: parseProviderData(provider.id, json) };
    }
    const text = await res.text();
    return { partial: parseProviderText(provider.id, text) };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "request-failed";
    return { partial: {}, failure: reason };
  } finally {
    clearTimeout(timeout);
  }
}

async function runAggregation(): Promise<{
  data: IntelData;
  attempted: string[];
  failures: DiagnosticFailure[];
  sourcesUsed: string[];
}> {
  const deadlineMs = Date.now() + OVERALL_TIMEOUT_MS;
  const attempted: string[] = [];
  const failures: DiagnosticFailure[] = [];
  const sourcesUsed = new Set<string>();
  let merged = { ...EMPTY_INTEL };
  let index = 0;
  let active = 0;
  let done = false;
  let stop = false;

  return await new Promise((resolve) => {
    const finish = () => {
      if (done) return;
      done = true;
      resolve({
        data: merged,
        attempted,
        failures,
        sourcesUsed: Array.from(sourcesUsed),
      });
    };

    const launch = () => {
      if (done) return;
      if ((stop || index >= PROVIDERS.length || Date.now() >= deadlineMs) && active === 0) {
        finish();
        return;
      }

      while (
        !done &&
        !stop &&
        active < CONCURRENCY_LIMIT &&
        index < PROVIDERS.length &&
        Date.now() < deadlineMs
      ) {
        const provider = PROVIDERS[index];
        index += 1;
        attempted.push(provider.id);
        active += 1;

        fetchProvider(provider, deadlineMs)
          .then(({ partial, failure }) => {
            if (failure) {
              failures.push({ source: provider.id, reason: failure });
              return;
            }
            const before = merged;
            merged = mergeIntel(merged, partial);
            if (
              merged.ipv4 !== before.ipv4 ||
              merged.ipv6 !== before.ipv6 ||
              merged.isp !== before.isp ||
              merged.city !== before.city ||
              merged.country !== before.country ||
              merged.lat !== before.lat ||
              merged.lon !== before.lon
            ) {
              sourcesUsed.add(provider.id);
            }
            if (shouldStopEarly(merged)) {
              stop = true;
            }
          })
          .catch(() => {
            failures.push({ source: provider.id, reason: "internal-failure" });
          })
          .finally(() => {
            active -= 1;
            launch();
          });
      }

      if ((stop || index >= PROVIDERS.length || Date.now() >= deadlineMs) && active === 0) {
        finish();
      }
    };

    const overallTimeout = setTimeout(() => {
      stop = true;
      if (active === 0) finish();
    }, OVERALL_TIMEOUT_MS + 25);

    launch();

    const interval = setInterval(() => {
      if (done) {
        clearInterval(interval);
        clearTimeout(overallTimeout);
      }
    }, 50);
  });
}

export async function GET(): Promise<NextResponse<NetworkIntelResponse>> {
  const { data, attempted, failures, sourcesUsed } = await runAggregation();

  const payload: NetworkIntelResponse = {
    success: hasAtLeastOneIp(data),
    data: {
      ...data,
      sourcesUsed,
    },
    diagnostics: {
      attempted,
      failures,
    },
  };

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
