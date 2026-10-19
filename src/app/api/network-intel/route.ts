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

type ProviderFormat = "json" | "text" | "cloudflare-trace";

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

const PHP_BACKEND_URL = process.env.PHP_BACKEND_URL || "http://127.0.0.1:8000";
const PROVIDER_TIMEOUT_MS = 3000;
const OVERALL_TIMEOUT_MS = 7000;
const CONCURRENCY_LIMIT = 8;

const BASE_IP_PROVIDERS: Provider[] = [
  { id: "cloudflare-1111", url: "https://1.1.1.1/cdn-cgi/trace", format: "cloudflare-trace" },
  { id: "cloudflare-trace", url: "https://www.cloudflare.com/cdn-cgi/trace", format: "cloudflare-trace" },
  { id: "countryis-ip", url: "https://api.country.is/", format: "json" },
  { id: "ipsb-ip", url: "https://api.ip.sb/ip", format: "text" },
  { id: "ipify-v4", url: "https://api4.ipify.org?format=json", format: "json" },
  { id: "ipify-v6", url: "https://api6.ipify.org?format=json", format: "json" },
  { id: "ipify-v64", url: "https://api64.ipify.org?format=json", format: "json" },
  { id: "icanhazip-v4", url: "https://ipv4.icanhazip.com", format: "text" },
  { id: "icanhazip-v6", url: "https://ipv6.icanhazip.com", format: "text" },
  { id: "identme-v4", url: "https://v4.ident.me", format: "text" },
  { id: "identme-v6", url: "https://v6.ident.me", format: "text" },
  { id: "seeip-json", url: "https://api.seeip.org/jsonip", format: "json" },
  { id: "ipquery-ip", url: "https://api.ipquery.io/", format: "text" },
];

const UNTARGETED_GEO_PROVIDERS: Provider[] = [
  { id: "ipwhois-geo", url: "https://ipwho.is/", format: "json" },
  {
    id: "ipapi-http-geo",
    url: "http://ip-api.com/json/?fields=status,message,country,countryCode,regionName,city,lat,lon,isp,org,as,query",
    format: "json",
  },
  { id: "ipquery-geo", url: "https://api.ipquery.io/", format: "json" },
  { id: "ipsb-geo", url: "https://api.ip.sb/geoip", format: "json" },
  { id: "ipwhoisapp-geo", url: "https://ipwhois.app/json/", format: "json" },
  { id: "seeip-geo", url: "https://api.seeip.org/geoip", format: "json" },
];

const TARGETED_GEO_PROVIDER_FACTORIES: TargetedProviderFactory[] = [
  {
    id: "ipwhois-geo-targeted",
    format: "json",
    buildUrl: (encodedIp) => `https://ipwho.is/${encodedIp}`,
  },
  {
    id: "ipapi-http-targeted",
    format: "json",
    buildUrl: (encodedIp) =>
      `http://ip-api.com/json/${encodedIp}?fields=status,message,country,countryCode,regionName,city,lat,lon,isp,org,as,query`,
  },
  {
    id: "ipquery-geo-targeted",
    format: "json",
    buildUrl: (encodedIp) => `https://api.ipquery.io/${encodedIp}`,
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
    id: "seeip-geo-targeted",
    format: "json",
    buildUrl: (encodedIp) => `https://api.seeip.org/geoip/${encodedIp}`,
  },
  {
    id: "ipinfo-geo-targeted",
    format: "json",
    buildUrl: (encodedIp) => `https://ipinfo.io/${encodedIp}/json`,
  },
];

function isPublicIp(ip: string): boolean {
  if (ip === "127.0.0.1" || ip === "::1" || ip === "localhost") return false;
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/.test(ip)) return false;
  if (/^(fc00|fe80)/i.test(ip)) return false;
  return true;
}

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
  if (detectIpFamily(candidate) && isPublicIp(candidate)) {
    return candidate;
  }
  return null;
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

function parseCloudflareTrace(text: string, extractCountry = true): Partial<IntelData> {
  const result: Partial<IntelData> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.includes("=")) continue;
    const [key, ...vals] = trimmed.split("=");
    const val = vals.join("=").trim();
    if (key === "ip") {
      Object.assign(result, normalizeIpCandidate(val));
    } else if (key === "loc" && extractCountry) {
      result.country = val.toUpperCase();
    }
  }
  return result;
}

function parseProviderData(providerId: string, body: unknown): Partial<IntelData> {
  const record = toRecord(body);

  if (providerId.startsWith("ipify-")) {
    return normalizeIpCandidate(pickString(record, ["ip"]));
  }

  if (providerId.startsWith("countryis-")) {
    const ip = pickString(record, ["ip"]);
    const country = pickString(record, ["country"]);
    return {
      ...normalizeIpCandidate(ip),
      ...(country ? { country } : {}),
    };
  }

  if (providerId === "seeip-json") {
    return normalizeIpCandidate(pickString(record, ["ip"]));
  }

  if (providerId.startsWith("seeip-geo")) {
    const ip = pickString(record, ["ip"]);
    return {
      ...normalizeIpCandidate(ip),
      city: pickString(record, ["city"]),
      country: pickString(record, ["country", "country_code"]),
      lat: pickCoordinate(record, ["latitude", "lat"]),
      lon: pickCoordinate(record, ["longitude", "lon"]),
    };
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

  if (providerId.startsWith("ipapi-http")) {
    const status = pickString(record, ["status"]);
    if (status && status.toLowerCase() === "fail") return {};

    const ip = pickString(record, ["query", "ip"]);
    return {
      ...normalizeIpCandidate(ip),
      isp: pickString(record, ["isp", "org", "as"]),
      city: pickString(record, ["city", "regionName"]),
      country: pickString(record, ["country", "countryCode"]),
      lat: pickCoordinate(record, ["lat", "latitude"]),
      lon: pickCoordinate(record, ["lon", "longitude"]),
    };
  }

  if (providerId.startsWith("ipquery-geo")) {
    const location = toRecord(record.location);
    const ispRecord = toRecord(record.isp);
    const ip = pickString(record, ["ip"]);
    return {
      ...normalizeIpCandidate(ip),
      isp: pickString(ispRecord, ["org", "isp", "asn"]),
      city: pickString(location, ["city", "state"]),
      country: pickString(location, ["country", "country_code"]),
      lat: pickCoordinate(location, ["latitude", "lat"]),
      lon: pickCoordinate(location, ["longitude", "lon"]),
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

  return {};
}

function parseProviderText(providerId: string, text: string, extractCountry = true): Partial<IntelData> {
  const value = text.trim();
  if (!value) return {};

  if (providerId.startsWith("cloudflare-")) {
    return parseCloudflareTrace(value, extractCountry);
  }

  return normalizeIpCandidate(value);
}

async function fetchProvider(
  provider: Provider,
  deadlineMs: number,
  hasHintedIp: boolean,
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
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)",
      },
    });
    if (!res.ok) return { partial: {}, failure: `http-${res.status}` };

    const isTargeted = provider.id.includes("-targeted");
    let partial: Partial<IntelData> = {};

    if (provider.format === "json") {
      const json = await res.json();
      partial = parseProviderData(provider.id, json);
    } else {
      const text = await res.text();
      partial = parseProviderText(provider.id, text, !hasHintedIp);
    }

    if (hasHintedIp && !isTargeted) {
      delete partial.country;
      delete partial.city;
      delete partial.lat;
      delete partial.lon;
      delete partial.isp;
    }

    return { partial };
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
  hasHintedIp: boolean;
}): Promise<{
  data: IntelData;
  attempted: string[];
  failures: DiagnosticFailure[];
  sourcesUsed: string[];
}> {
  const { providers, seededData, seededSources, hasHintedIp } = options;
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

        fetchProvider(provider, deadlineMs, hasHintedIp)
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
  // 1. Try PHP Backend first (if running locally or configured via PHP_BACKEND_URL)
  try {
    const backendUrl = PHP_BACKEND_URL.replace(/\/$/, "");
    const forwardedHeaders: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      forwardedHeaders[key] = value;
    });

    const phpController = new AbortController();
    const phpTimeout = setTimeout(() => phpController.abort(), 2000);

    const phpRes = await fetch(`${backendUrl}/api/network-intel`, {
      method: "GET",
      headers: forwardedHeaders,
      signal: phpController.signal,
      cache: "no-store",
    }).finally(() => clearTimeout(phpTimeout));

    if (phpRes.ok) {
      const phpData = (await phpRes.json()) as NetworkIntelResponse;
      if (phpData.success) {
        return NextResponse.json(phpData, {
          headers: {
            "Cache-Control": "no-store",
            "X-Backend-Engine": "PHP-MultiCurl",
          },
        });
      }
    }
  } catch {
    // PHP backend not running / unreachable (e.g. Netlify serverless deployment).
    // Gracefully fallback to internal resilient engine below.
  }

  // 2. Resilient Fallback: Internal Async Multi-Provider Aggregation
  const { ip: hintedIp, source: hintSource } = getClientIpHint(request);
  const providers: Provider[] = [];

  if (hintedIp) {
    const encodedIp = encodeURIComponent(hintedIp);
    providers.push(
      ...TARGETED_GEO_PROVIDER_FACTORIES.map((p) => ({
        id: p.id,
        format: p.format,
        url: p.buildUrl(encodedIp),
      })),
    );
    providers.push(...BASE_IP_PROVIDERS);
  } else {
    providers.push(...BASE_IP_PROVIDERS, ...UNTARGETED_GEO_PROVIDERS);
  }

  const seededData = hintedIp ? normalizeIpCandidate(hintedIp) : {};
  const seededSources = hintedIp ? [`request-header:${hintSource ?? "ip-hint"}`] : [];

  const { data, attempted, failures, sourcesUsed } = await runAggregation({
    providers,
    seededData,
    seededSources,
    hasHintedIp: Boolean(hintedIp),
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
      "X-Backend-Engine": "NextJS-Fallback",
    },
  });
}
