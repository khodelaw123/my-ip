"use client";

import { Github, RefreshCcw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import {
  EMPTY_INTEL,
  detectIpFamily,
  hasAtLeastOneIp,
  isGeoWeak,
  isMeaningfulText,
  mergeIntel,
  parseCoordinate,
  parseLocPair,
  type IntelData,
} from "@/lib/network-intel";

type FetchState = {
  loading: boolean;
  error: string | null;
  data: IntelData | null;
};

type NetworkIntelResponse = {
  success: boolean;
  data: IntelData & {
    sourcesUsed: string[];
  };
  diagnostics?: {
    attempted: string[];
    failures: { source: string; reason: string }[];
  };
};

type ProviderFormat = "json" | "text";

type Provider = {
  id: string;
  url: string;
  format: ProviderFormat;
};

const REQUEST_TIMEOUT_MS = 3500;
const SERVER_TIMEOUT_MS = 7000;
const FALLBACK_TEXT = "\u0646\u0627\u0645\u0634\u062e\u0635";
const TITLE_TEXT = "\u0622\u062f\u0631\u0633 IP \u0634\u0645\u0627:";

const BROWSER_PROVIDERS: Provider[] = [
  { id: "ipify-v4", url: "https://api4.ipify.org?format=json", format: "json" },
  { id: "ipify-v6", url: "https://api6.ipify.org?format=json", format: "json" },
  { id: "ipify-v64", url: "https://api64.ipify.org?format=json", format: "json" },
  { id: "ipify-generic", url: "https://api.ipify.org?format=json", format: "json" },
  { id: "ipsb-ip", url: "https://api.ip.sb/ip", format: "text" },
  { id: "ipsb64-ip", url: "https://api64.ip.sb/ip", format: "text" },
  { id: "icanhazip-v4", url: "https://ipv4.icanhazip.com", format: "text" },
  { id: "icanhazip-v6", url: "https://ipv6.icanhazip.com", format: "text" },
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

function parseProviderJson(providerId: string, body: unknown): Partial<IntelData> {
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
    return {
      ...normalizeIpCandidate(pickString(record, ["ip"])),
      isp: pickString(connection, ["isp", "org", "organization"]),
      city: pickString(record, ["city"]),
      country: pickString(record, ["country", "country_name", "countryCode", "country_code"]),
      lat: pickCoordinate(record, ["latitude", "lat"]),
      lon: pickCoordinate(record, ["longitude", "lon"]),
    };
  }

  if (providerId === "ipapi-geo") {
    return {
      ...normalizeIpCandidate(pickString(record, ["ip"])),
      isp: pickString(record, ["org", "isp", "asn_org"]),
      city: pickString(record, ["city"]),
      country: pickString(record, ["country_name", "country", "country_code"]),
      lat: pickCoordinate(record, ["latitude", "lat"]),
      lon: pickCoordinate(record, ["longitude", "lon"]),
    };
  }

  if (providerId === "ipinfo-geo") {
    const loc = parseLocPair(pickString(record, ["loc"]));
    return {
      ...normalizeIpCandidate(pickString(record, ["ip"])),
      isp: pickString(record, ["org"]),
      city: pickString(record, ["city"]),
      country: pickString(record, ["country"]),
      lat: loc.lat,
      lon: loc.lon,
    };
  }

  if (providerId === "freeipapi-geo") {
    return {
      ...normalizeIpCandidate(pickString(record, ["ipAddress", "ip"])),
      isp: pickString(record, ["isp", "organizationName", "organization"]),
      city: pickString(record, ["cityName", "city"]),
      country: pickString(record, ["countryName", "countryCode", "country"]),
      lat: pickCoordinate(record, ["latitude", "lat"]),
      lon: pickCoordinate(record, ["longitude", "lon"]),
    };
  }

  if (providerId === "ipsb-geo") {
    return {
      ...normalizeIpCandidate(pickString(record, ["ip"])),
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
    providerId === "icanhazip-v6"
  ) {
    return normalizeIpCandidate(value);
  }
  return {};
}

async function fetchWithTimeout(
  url: string,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
    });
  } finally {
    clearTimeout(timeout);
  }
}

function typeText(
  text: string,
  setValue: (value: string) => void,
  speedMs: number,
  disabled: boolean,
): () => void {
  if (disabled) {
    setValue(text);
    return () => undefined;
  }

  setValue("");
  let index = 0;
  const interval = window.setInterval(() => {
    index += 1;
    setValue(text.slice(0, index));
    if (index >= text.length) {
      window.clearInterval(interval);
    }
  }, speedMs);

  return () => window.clearInterval(interval);
}

async function runBrowserAggregation(): Promise<{ data: IntelData }> {
  const settled = await Promise.allSettled(
    BROWSER_PROVIDERS.map(async (provider) => {
      const res = await fetchWithTimeout(provider.url, REQUEST_TIMEOUT_MS);
      if (!res.ok) {
        throw new Error(`http-${res.status}`);
      }

      if (provider.format === "json") {
        const body = await res.json();
        return { id: provider.id, partial: parseProviderJson(provider.id, body) };
      }

      const text = await res.text();
      return { id: provider.id, partial: parseProviderText(provider.id, text) };
    }),
  );

  let merged = { ...EMPTY_INTEL };
  for (let i = 0; i < settled.length; i += 1) {
    const item = settled[i];
    if (item.status === "fulfilled") {
      merged = mergeIntel(merged, item.value.partial);
    }
  }

  return { data: merged };
}

function mergeMissingFromServer(browserData: IntelData, serverData: IntelData): IntelData {
  const merged = { ...browserData };

  if (!merged.ipv4 && serverData.ipv4) merged.ipv4 = serverData.ipv4;
  if (!merged.ipv6 && serverData.ipv6) merged.ipv6 = serverData.ipv6;

  if (!isMeaningfulText(merged.city) && serverData.city) merged.city = serverData.city;
  if (!isMeaningfulText(merged.country) && serverData.country) merged.country = serverData.country;
  if (!isMeaningfulText(merged.isp) && serverData.isp) merged.isp = serverData.isp;

  if ((merged.lat === null || merged.lon === null) && serverData.lat !== null && serverData.lon !== null) {
    merged.lat = serverData.lat;
    merged.lon = serverData.lon;
  }

  return merged;
}

export default function Home() {
  const [state, setState] = useState<FetchState>({
    loading: true,
    error: null,
    data: null,
  });
  const [isScrolled, setIsScrolled] = useState(false);
  const [typedTitle, setTypedTitle] = useState("");
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  const refreshIpData = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const browser = await runBrowserAggregation();
      let finalData = browser.data;

      if (!hasAtLeastOneIp(finalData) || isGeoWeak(finalData)) {
        try {
          const serverRes = await fetchWithTimeout("/api/network-intel", SERVER_TIMEOUT_MS);
          if (serverRes.ok) {
            const serverJson = (await serverRes.json()) as NetworkIntelResponse;
            if (serverJson.success && serverJson.data) {
              finalData = mergeMissingFromServer(finalData, serverJson.data);
            }
          }
        } catch {
          // Keep browser aggregation results when server fallback fails.
        }
      }

      if (!hasAtLeastOneIp(finalData)) {
        throw new Error("missing all ip families");
      }

      setState({
        loading: false,
        error: null,
        data: finalData,
      });
    } catch {
      setState({
        loading: false,
        error:
          "\u062e\u0637\u0627 \u062f\u0631 \u062f\u0631\u06cc\u0627\u0641\u062a \u0627\u0637\u0644\u0627\u0639\u0627\u062a. \u0644\u0637\u0641\u0627\u064b \u062f\u0648\u0628\u0627\u0631\u0647 \u0627\u0645\u062a\u062d\u0627\u0646 \u06a9\u0646\u06cc\u062f.",
        data: null,
      });
    }
  }, []);

  useEffect(() => {
    void refreshIpData();
  }, [refreshIpData]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const setFromMedia = () => setPrefersReducedMotion(media.matches);
    setFromMedia();

    media.addEventListener("change", setFromMedia);
    return () => media.removeEventListener("change", setFromMedia);
  }, []);

  useEffect(() => typeText(TITLE_TEXT, setTypedTitle, 65, prefersReducedMotion), [prefersReducedMotion]);

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const lat = state.data?.lat;
  const lon = state.data?.lon;
  const hasCoordinates = typeof lat === "number" && typeof lon === "number";
  const mapEmbedUrl = hasCoordinates
    ? `https://www.google.com/maps?q=${lat},${lon}&z=6&output=embed`
    : null;

  return (
    <div className="min-h-screen text-slate-900">
      <header
        className={`fixed left-1/2 top-4 z-30 w-[min(92vw,760px)] -translate-x-1/2 rounded-[2rem] border border-slate-200/80 backdrop-blur-md transition-all duration-300 ${isScrolled ? "scale-[1.04] bg-white/95 py-1 shadow-[0_14px_36px_rgba(15,23,42,0.2)]" : "bg-white/88 shadow-[0_8px_24px_rgba(15,23,42,0.12)]"}`}
      >
        <div className="mx-auto flex w-full items-center justify-between px-4 py-3 sm:px-6">
          <h1 className="text-right text-xl font-bold text-slate-900 sm:text-2xl">
            {"\u0622\u062f\u0631\u0633 IP \u0634\u0645\u0627"}
          </h1>
          <button
            type="button"
            onClick={() => void refreshIpData()}
            aria-label={
              "\u0628\u0647\u200c\u0631\u0648\u0632\u0631\u0633\u0627\u0646\u06cc \u0627\u0637\u0644\u0627\u0639\u0627\u062a IP"
            }
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-900 shadow-sm transition-transform duration-200 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-white"
          >
            <RefreshCcw className={`h-4 w-4 ${state.loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>

      <main className="flex min-h-screen items-center justify-center px-4 pb-40 pt-36 sm:px-6 md:pt-40 lg:px-8">
        <section className="glass animate-fade-in-up w-full max-w-2xl rounded-3xl px-6 py-8 sm:px-8 sm:py-10">
          <h2 className="text-2xl font-bold text-slate-900 sm:text-4xl">
            <span className="typing-caret">{typedTitle || "\u00a0"}</span>
          </h2>

          {state.loading ? (
            <div className="mt-8 flex items-center gap-3 text-slate-700">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <span className="text-base sm:text-lg">
                {"\u062f\u0631 \u062d\u0627\u0644 \u062f\u0631\u06cc\u0627\u0641\u062a \u0627\u0637\u0644\u0627\u0639\u0627\u062a..."}
              </span>
            </div>
          ) : null}

          {state.error ? (
            <p className="mt-8 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 sm:text-base">
              {state.error}
            </p>
          ) : null}

          {state.data ? (
            <div className="mt-7 space-y-5">
              <div className="space-y-3">
                <div className="rounded-2xl border border-sky-100 bg-sky-50 px-4 py-3 text-left text-sky-700" dir="ltr">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-sky-500">IPv4</p>
                  <p className="break-all font-mono text-sm font-bold sm:text-base">
                    {state.data.ipv4 || FALLBACK_TEXT}
                  </p>
                </div>
                <div className="rounded-2xl border border-cyan-100 bg-cyan-50 px-4 py-3 text-left text-cyan-700" dir="ltr">
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-cyan-500">IPv6</p>
                  <p className="break-all font-mono text-sm font-bold sm:text-base">
                    {state.data.ipv6 || FALLBACK_TEXT}
                  </p>
                </div>
              </div>

              <ul className="space-y-3 text-base text-slate-800 sm:text-lg">
                <li className="rounded-xl bg-white/80 px-4 py-2 text-right">
                  <span className="font-semibold">
                    {
                      "\u0627\u0631\u0627\u0626\u0647\u200c\u062f\u0647\u0646\u062f\u0647 \u0627\u06cc\u0646\u062a\u0631\u0646\u062a:"
                    }
                  </span>{" "}
                  {state.data.isp || FALLBACK_TEXT}
                </li>
                <li className="rounded-xl bg-white/80 px-4 py-2 text-right">
                  <span className="font-semibold">
                    {"\u0634\u0647\u0631 \u062a\u0642\u0631\u06cc\u0628\u06cc:"}
                  </span>{" "}
                  {state.data.city || FALLBACK_TEXT}
                </li>
                <li className="rounded-xl bg-white/80 px-4 py-2 text-right">
                  <span className="font-semibold">{"\u06a9\u0634\u0648\u0631:"}</span>{" "}
                  {state.data.country || FALLBACK_TEXT}
                </li>
              </ul>

              <div className="rounded-2xl border border-slate-200 bg-white/90 p-3">
                {!mapEmbedUrl ? (
                  <p className="text-sm text-slate-600">
                    {
                      "\u0645\u062e\u062a\u0635\u0627\u062a \u0628\u0631\u0627\u06cc \u0646\u0645\u0627\u06cc\u0634 \u0646\u0642\u0634\u0647 \u062f\u0631 \u062f\u0633\u062a\u0631\u0633 \u0646\u06cc\u0633\u062a."
                    }
                  </p>
                ) : (
                  <iframe
                    src={mapEmbedUrl}
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                    title={"\u0646\u0642\u0634\u0647 \u0645\u0648\u0642\u0639\u06cc\u062a \u062a\u0642\u0631\u06cc\u0628\u06cc IP"}
                    className="h-64 w-full overflow-hidden rounded-xl border border-slate-200"
                    aria-label={
                      "\u0646\u0642\u0634\u0647 \u0645\u0648\u0642\u0639\u06cc\u062a \u062a\u0642\u0631\u06cc\u0628\u06cc IP"
                    }
                  />
                )}
              </div>
            </div>
          ) : null}

          <button
            type="button"
            onClick={() => void refreshIpData()}
            className="mt-8 inline-flex min-h-11 items-center justify-center rounded-2xl bg-primary px-6 py-3 text-base font-semibold text-white shadow-lg shadow-primary/20 transition-transform duration-200 hover:scale-[1.02] hover:bg-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-slate-100"
          >
            {"\u0628\u0647\u200c\u0631\u0648\u0632\u0631\u0633\u0627\u0646\u06cc"}
          </button>
        </section>
      </main>

      <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 py-3 text-slate-800 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-center gap-2 px-4 text-center text-xs sm:justify-between sm:gap-4 sm:px-6 sm:text-sm lg:px-8">
          <p>
            {"\u00A9 \u06F1\u06F4\u06F0\u06F4 - \u062A\u0645\u0627\u0645 \u062D\u0642\u0648\u0642 \u0645\u062D\u0641\u0648\u0638 \u0627\u0633\u062A"}
          </p>
          <div className="flex items-center gap-3"></div>
          <div className="flex items-center gap-3">
            <a
              aria-label="GitHub"
              href="https://github.com/khodelaw123/my-ip"
              className="rounded-full p-1.5 transition-colors hover:bg-slate-100"
            >
              <Github className="h-4 w-4" />
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

