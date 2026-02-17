import { NextRequest, NextResponse } from "next/server";
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

type TargetedProviderFactory = {
  id: string;
  format: ProviderFormat;
  buildUrl: (encodedIp: string) => string;
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
const OVERALL_TIMEOUT_MS = 10000;
const CONCURRENCY_LIMIT = 6;

const BASE_IP_PROVIDERS: Provider[] = [
  { id: "ipify-v4", url: "https://api4.ipify.org?format=json", format: "json" },
  { id: "ipify-v6", url: "https://api6.ipify.org?format=json", format: "json" },
  { id: "ipify-v64", url: "https://api64.ipify.org?format=json", format: "json" },
  { id: "ipify-generic", url: "https://api.ipify.org?format=json", format: "json" },
  { id: "ipsb-ip", url: "https://api.ip.sb/ip", format: "text" },
  { id: "ipsb64-ip", url: "https://api64.ip.sb/ip", format: "text" },
  { id: "icanhazip-v4", url: "https://ipv4.icanhazip.com", format: "text" },
  { id: "icanhazip-v6", url: "https://ipv6.icanhazip.com", format: "text" },
  { id: "ifconfig-ip", url: "https://ifconfig.me/ip", format: "text" },
  { id: "identme-ip", url: "https://ident.me", format: "text" },
  { id: "checkip-amazon-ip", url: "https://checkip.amazonaws.com", format: "text" },
  { id: "seeip-ip", url: "https://ip.seeip.org", format: "text" },
  { id: "ifconfigco-ip", url: "https://ifconfig.co/ip", format: "text" },
  { id: "myexternalip-ip", url: "https://myexternalip.com/raw", format: "text" },
];

const UNTARGETED_GEO_PROVIDERS: Provider[] = [
  { id: "ipwhois-geo", url: "https://ipwho.is/", format: "json" },
  { id: "ipapi-geo", url: "https://ipapi.co/json/", format: "json" },
  { id: "ipinfo-geo", url: "https://ipinfo.io/json", format: "json" },
  { id: "freeipapi-geo", url: "https://freeipapi.com/api/json", format: "json" },
  { id: "ipsb-geo", url: "https://api.ip.sb/geoip", format: "json" },
  { id: "ipwhoisapp-geo", url: "https://ipwhois.app/json/", format: "json" },
  { id: "geolocationdb-geo", url: "https://geolocation-db.com/json/", format: "json" },
  { id: "ifconfigco-geo", url: "https://ifconfig.co/json", format: "json" },
  { id: "myip-geo", url: "https://api.myip.com", format: "json" },
  {
    id: "ipapihttp-geo",
    url: "http://ip-api.com/json/?fields=status,message,country,countryCode,city,regionName,lat,lon,isp,org,query",
    format: "json",
  },
];

const TARGETED_GEO_PROVIDER_FACTORIES: TargetedProviderFactory[] = [
  {
    id: "ipwhois-geo-targeted",
    format: "json",
    buildUrl: (encodedIp) => `https://ipwho.is/${encodedIp}`,
  },
  {
    id: "ipapi-geo-targeted",
    format: "json",
    buildUrl: (encodedIp) => `https://ipapi.co/${encodedIp}/json/`,
  },
  {
    id: "ipinfo-geo-targeted",
    format: "json",
    buildUrl: (encodedIp) => `https://ipinfo.io/${encodedIp}/json`,
  },
  {
    id: "freeipapi-geo-targeted",
    format: "json",
    buildUrl: (encodedIp) => `https://freeipapi.com/api/json/${encodedIp}`,
  },
  {
    id: "ipsb-geo-targeted",
    format: "json",
    buildUrl: (encodedIp) => `https://api.ip.sb/geoip/${encodedIp}`,
  },
  {
    id: "ipwhoisapp-geo-targeted",
    format: "json",
    buildUrl: (encodedIp) => `https://ipwhois.app/json/${encodedIp}`,
  },
  {
    id: "geolocationdb-geo-targeted",
    format: "json",
    buildUrl: (encodedIp) => `https://geolocation-db.com/json/${encodedIp}&position=true`,
  },
  {
    id: "ipapihttp-geo-targeted",
    format: "json",
    buildUrl: (encodedIp) =>
      `http://ip-api.com/json/${encodedIp}?fields=status,message,country,countryCode,city,regionName,lat,lon,isp,org,query`,
  },
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

function cleanIpCandidate(value: string): string | null {
  let candidate = value.trim();
  if (!candidate) return null;

  candidate = candidate.replace(/^for=/i, "").trim();
  candidate = candidate.replace(/^"(.+)"$/, "$1");

  const semicolonIndex = candidate.indexOf(";");
  if (semicolonIndex >= 0) {
    candidate = candidate.slice(0, semicolonIndex).trim();
  }

  if (candidate.startsWith("[")) {
    const endBracket = candidate.indexOf("]");
    if (endBracket > 0) {
      candidate = candidate.slice(1, endBracket);
    }
  }

  if (candidate.includes(".") && candidate.includes(":")) {
    candidate = candidate.split(":")[0];
  }

  candidate = candidate.split("%")[0];
  return detectIpFamily(candidate) ? candidate : null;
}

function parseIpFromHeaderValue(raw: string): string | null {
  const parts = raw.split(",");
  for (const part of parts) {
    const forwardedMatch = part.match(/for=(?:"?\[?([0-9a-fA-F:.%]+)\]?"?)/i);
    if (forwardedMatch?.[1]) {
      const fromForwarded = cleanIpCandidate(forwardedMatch[1]);
      if (fromForwarded) return fromForwarded;
    }

    const direct = cleanIpCandidate(part);
    if (direct) return direct;
  }
  return null;
}

function getClientIpHint(request: NextRequest): { ip: string | null; source: string | null } {
  const headerOrder = [
    "x-nf-client-connection-ip",
    "cf-connecting-ip",
    "true-client-ip",
    "x-real-ip",
    "x-forwarded-for",
    "x-vercel-forwarded-for",
    "forwarded",
  ];

  for (const headerName of headerOrder) {
    const rawValue = request.headers.get(headerName);
    if (!rawValue) continue;
    const ip = parseIpFromHeaderValue(rawValue);
    if (ip) return { ip, source: headerName };
  }

  return { ip: null, source: null };
}

function buildProviders(clientIp: string | null): Provider[] {
  const providers: Provider[] = [...BASE_IP_PROVIDERS];

  if (clientIp) {
    const encodedIp = encodeURIComponent(clientIp);
    providers.push(
      ...TARGETED_GEO_PROVIDER_FACTORIES.map((provider) => ({
        id: provider.id,
        format: provider.format,
        url: provider.buildUrl(encodedIp),
      })),
    );
  }

  providers.push(...UNTARGETED_GEO_PROVIDERS);
  return providers;
}

function parseProviderData(providerId: string, body: unknown): Partial<IntelData> {
  const record = toRecord(body);

  if (providerId.startsWith("ipify-")) {
    return normalizeIpCandidate(pickString(record, ["ip"]));
  }

  if (providerId.startsWith("ipwhois-geo")) {
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

  if (providerId.startsWith("ipapi-geo")) {
    const ip = pickString(record, ["ip"]);
    const country = pickString(record, ["country_name", "country", "country_code"]);
    return {
      ...normalizeIpCandidate(ip),
      isp: pickString(record, ["org", "isp", "asn_org"]),
      city: pickString(record, ["city", "region", "region_name"]),
      country,
      lat: pickCoordinate(record, ["latitude", "lat"]),
      lon: pickCoordinate(record, ["longitude", "lon"]),
    };
  }

  if (providerId.startsWith("ipinfo-geo")) {
    const ip = pickString(record, ["ip"]);
    const loc = parseLocPair(pickString(record, ["loc"]));
    return {
      ...normalizeIpCandidate(ip),
      isp: pickString(record, ["org"]),
      city: pickString(record, ["city", "region"]),
      country: pickString(record, ["country"]),
      lat: loc.lat,
      lon: loc.lon,
    };
  }

  if (providerId.startsWith("freeipapi-geo")) {
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

  if (providerId.startsWith("ipsb-geo")) {
    const ip = pickString(record, ["ip"]);
    return {
      ...normalizeIpCandidate(ip),
      isp: pickString(record, ["isp", "organization", "asn_organization"]),
      city: pickString(record, ["city", "region"]),
      country: pickString(record, ["country", "country_name", "country_code"]),
      lat: pickCoordinate(record, ["latitude", "lat"]),
      lon: pickCoordinate(record, ["longitude", "lon"]),
    };
  }

  if (providerId.startsWith("ipwhoisapp-geo")) {
    const ip = pickString(record, ["ip"]);
    return {
      ...normalizeIpCandidate(ip),
      isp: pickString(record, ["isp", "org", "organization"]),
      city: pickString(record, ["city", "region"]),
      country: pickString(record, ["country", "country_code"]),
      lat: pickCoordinate(record, ["latitude", "lat"]),
      lon: pickCoordinate(record, ["longitude", "lon"]),
    };
  }

  if (providerId.startsWith("geolocationdb-geo")) {
    const ip = pickString(record, ["IPv4", "ip"]);
    return {
      ...normalizeIpCandidate(ip),
      city: pickString(record, ["city", "region", "state"]),
      country: pickString(record, ["country_name", "country_code", "country"]),
      lat: pickCoordinate(record, ["latitude", "lat"]),
      lon: pickCoordinate(record, ["longitude", "lon"]),
    };
  }

  if (providerId.startsWith("ifconfigco-geo")) {
    const ip = pickString(record, ["ip"]);
    return {
      ...normalizeIpCandidate(ip),
      isp: pickString(record, ["asn_org", "org"]),
      city: pickString(record, ["city", "region_name", "region"]),
      country: pickString(record, ["country", "country_iso"]),
      lat: pickCoordinate(record, ["latitude", "lat"]),
      lon: pickCoordinate(record, ["longitude", "lon"]),
    };
  }

  if (providerId.startsWith("myip-geo")) {
    const ip = pickString(record, ["ip"]);
    return {
      ...normalizeIpCandidate(ip),
      country: pickString(record, ["country", "cc"]),
    };
  }

  if (providerId.startsWith("ipapihttp-geo")) {
    const status = pickString(record, ["status"]);
    if (status && status.toLowerCase() === "fail") return {};

    const ip = pickString(record, ["query", "ip"]);
    return {
      ...normalizeIpCandidate(ip),
      isp: pickString(record, ["isp", "org"]),
      city: pickString(record, ["city", "regionName"]),
      country: pickString(record, ["country", "countryCode"]),
      lat: pickCoordinate(record, ["lat", "latitude"]),
      lon: pickCoordinate(record, ["lon", "longitude"]),
    };
  }

  return {};
}

function parseProviderText(providerId: string, text: string): Partial<IntelData> {
  const value = text.trim();
  if (!value) return {};
  if (providerId.endsWith("-ip")) {
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

async function runAggregation(options: {
  providers: Provider[];
  seededData?: Partial<IntelData>;
  seededSources?: string[];
}): Promise<{
  data: IntelData;
  attempted: string[];
  failures: DiagnosticFailure[];
  sourcesUsed: string[];
}> {
  const { providers, seededData, seededSources } = options;
  const deadlineMs = Date.now() + OVERALL_TIMEOUT_MS;
  const attempted: string[] = [];
  const failures: DiagnosticFailure[] = [];
  const sourcesUsed = new Set<string>(seededSources ?? []);
  let merged = mergeIntel({ ...EMPTY_INTEL }, seededData ?? {});
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
      if ((stop || index >= providers.length || Date.now() >= deadlineMs) && active === 0) {
        finish();
        return;
      }

      while (
        !done &&
        !stop &&
        active < CONCURRENCY_LIMIT &&
        index < providers.length &&
        Date.now() < deadlineMs
      ) {
        const provider = providers[index];
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

      if ((stop || index >= providers.length || Date.now() >= deadlineMs) && active === 0) {
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

export async function GET(request: NextRequest): Promise<NextResponse<NetworkIntelResponse>> {
  const { ip: hintedIp, source: hintSource } = getClientIpHint(request);
  const providers = buildProviders(hintedIp);
  const seededData = hintedIp ? normalizeIpCandidate(hintedIp) : {};
  const seededSources = hintedIp ? [`request-header:${hintSource ?? "ip-hint"}`] : [];

  const { data, attempted, failures, sourcesUsed } = await runAggregation({
    providers,
    seededData,
    seededSources,
  });

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
