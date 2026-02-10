"use client";

import { Github, RefreshCcw, Twitter } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

type IpDetails = {
  ip: string;
  ipType: "IPv4" | "IPv6";
  isp: string;
  city: string;
  country: string;
  lat: number | null;
  lon: number | null;
};

type FetchState = {
  loading: boolean;
  error: string | null;
  data: IpDetails | null;
};

type IpifyResponse = {
  ip?: string;
};

type IpWhoIsResponse = {
  success?: boolean;
  message?: string;
  connection?: {
    isp?: string;
  };
  city?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
};

const REQUEST_TIMEOUT_MS = 9000;
const FALLBACK_TEXT = "نامشخص";
const TITLE_TEXT = "آدرس IP شما:";

function detectIpType(ip: string): "IPv4" | "IPv6" {
  return ip.includes(":") ? "IPv6" : "IPv4";
}

function parseCoordinate(value?: number | string): number | null {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
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

export default function Home() {
  const [state, setState] = useState<FetchState>({
    loading: true,
    error: null,
    data: null,
  });
  const [isScrolled, setIsScrolled] = useState(false);
  const [typedTitle, setTypedTitle] = useState("");
  const [typedIp, setTypedIp] = useState("");
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  const refreshIpData = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const ipRes = await fetchWithTimeout("https://api.ipify.org?format=json");
      if (!ipRes.ok) {
        throw new Error("ipify response not ok");
      }

      const ipJson = (await ipRes.json()) as IpifyResponse;
      const ip = ipJson.ip?.trim();
      if (!ip) {
        throw new Error("missing ip");
      }

      const geoRes = await fetchWithTimeout(`https://ipwho.is/${ip}`);
      if (!geoRes.ok) {
        throw new Error("ipwhois response not ok");
      }

      const geoJson = (await geoRes.json()) as IpWhoIsResponse;
      if (geoJson.success === false) {
        throw new Error(geoJson.message || "ipwhois error");
      }

      const isp = geoJson.connection?.isp?.trim() || FALLBACK_TEXT;
      const city = geoJson.city?.trim() || FALLBACK_TEXT;
      const country = geoJson.country?.trim() || FALLBACK_TEXT;
      const lat = parseCoordinate(geoJson.latitude);
      const lon = parseCoordinate(geoJson.longitude);

      setState({
        loading: false,
        error: null,
        data: {
          ip,
          ipType: detectIpType(ip),
          isp,
          city,
          country,
          lat,
          lon,
        },
      });
    } catch {
      setState({
        loading: false,
        error: "خطا در دریافت اطلاعات. لطفاً دوباره امتحان کنید.",
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
    const nextIp = state.data?.ip ?? "";
    return typeText(nextIp, setTypedIp, 55, prefersReducedMotion || !nextIp);
  }, [state.data?.ip, prefersReducedMotion]);

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
        className={`fixed inset-x-0 top-0 z-30 border-b border-slate-200 transition-all duration-300 ${isScrolled ? "bg-white/95 shadow-[0_8px_30px_rgba(15,23,42,0.14)]" : "bg-white/85 shadow-[0_4px_16px_rgba(15,23,42,0.08)]"}`}
      >
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <h1 className="text-right text-xl font-bold text-slate-900 sm:text-2xl">آدرس IP شما</h1>
          <button
            type="button"
            onClick={() => void refreshIpData()}
            aria-label="به‌روزرسانی اطلاعات IP"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-900 shadow-sm transition-transform duration-200 hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-white"
          >
            <RefreshCcw className={`h-4 w-4 ${state.loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>

      <main className="flex min-h-screen items-center justify-center px-4 pb-40 pt-28 sm:px-6 md:pt-32 lg:px-8">
        <section className="glass animate-fade-in-up w-full max-w-2xl rounded-3xl px-6 py-8 sm:px-8 sm:py-10">
          <h2 className="text-2xl font-bold text-slate-900 sm:text-4xl">
            <span className="typing-caret">{typedTitle || "\u00a0"}</span>
          </h2>

          {state.loading ? (
            <div className="mt-8 flex items-center gap-3 text-slate-700">
              <span className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
              <span className="text-base sm:text-lg">در حال دریافت اطلاعات...</span>
            </div>
          ) : null}

          {state.error ? (
            <p className="mt-8 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 sm:text-base">
              {state.error}
            </p>
          ) : null}

          {state.data ? (
            <div className="mt-7 space-y-5">
              <p className="rounded-2xl border border-sky-100 bg-sky-50 px-4 py-3 text-left font-mono text-2xl font-bold tracking-wide text-sky-600 sm:text-4xl" dir="ltr">
                <span className="typing-caret-ltr">{typedIp || "\u00a0"}</span>
              </p>

              <ul className="space-y-3 text-base text-slate-800 sm:text-lg">
                <li className="rounded-xl bg-white/80 px-4 py-2 text-right">
                  <span className="font-semibold">نوع IP:</span>{" "}
                  <span dir="ltr" className="inline-block [unicode-bidi:isolate]">
                    {state.data.ipType}
                  </span>
                </li>
                <li className="rounded-xl bg-white/80 px-4 py-2 text-right">
                  <span className="font-semibold">ارائه‌دهنده اینترنت:</span> {state.data.isp}
                </li>
                <li className="rounded-xl bg-white/80 px-4 py-2 text-right">
                  <span className="font-semibold">شهر تقریبی:</span> {state.data.city}
                </li>
                <li className="rounded-xl bg-white/80 px-4 py-2 text-right">
                  <span className="font-semibold">کشور:</span> {state.data.country}
                </li>
              </ul>

              <div className="rounded-2xl border border-slate-200 bg-white/90 p-3">
                {!mapEmbedUrl ? (
                  <p className="text-sm text-slate-600">مختصات برای نمایش نقشه در دسترس نیست.</p>
                ) : (
                  <iframe
                    src={mapEmbedUrl}
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                    title="نقشه موقعیت تقریبی IP"
                    className="h-64 w-full overflow-hidden rounded-xl border border-slate-200"
                    aria-label="نقشه موقعیت تقریبی IP"
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
            به‌روزرسانی
          </button>
        </section>
      </main>

      <footer className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 py-3 text-slate-800 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-center gap-2 px-4 text-center text-xs sm:justify-between sm:gap-4 sm:px-6 sm:text-sm lg:px-8">
          <p>© ۱۴۰۴ - تمام حقوق محفوظ است</p>
          <div className="flex items-center gap-3">
            <a className="transition-colors hover:text-accent" href="#">
              سیاست حفظ حریم خصوصی
            </a>
            <a className="transition-colors hover:text-accent" href="#">
              شرایط استفاده
            </a>
          </div>
          <div className="flex items-center gap-3">
            <a
              aria-label="GitHub"
              href="#"
              className="rounded-full p-1.5 transition-colors hover:bg-slate-100"
            >
              <Github className="h-4 w-4" />
            </a>
            <a
              aria-label="Twitter"
              href="#"
              className="rounded-full p-1.5 transition-colors hover:bg-slate-100"
            >
              <Twitter className="h-4 w-4" />
            </a>
          </div>
          <p className="w-full text-[11px] text-slate-500 sm:w-auto sm:text-xs">
            این اطلاعات تقریبی است و برای اهداف آموزشی ارائه می‌شود.
          </p>
        </div>
      </footer>
    </div>
  );
}
