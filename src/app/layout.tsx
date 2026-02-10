import type { Metadata } from "next";
import { Vazirmatn } from "next/font/google";
import "./globals.css";

const vazirmatn = Vazirmatn({
  variable: "--font-vazirmatn",
  subsets: ["arabic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "آدرس IP شما",
  description: "نمایش سریع آدرس IP عمومی شما به همراه اطلاعات تقریبی مکان",
  icons: {
    icon: "/icon.svg",
  },
  openGraph: {
    title: "آدرس IP شما",
    description: "نمایش سریع آدرس IP عمومی شما به همراه اطلاعات تقریبی مکان",
    locale: "fa_IR",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "آدرس IP شما",
    description: "نمایش سریع آدرس IP عمومی شما به همراه اطلاعات تقریبی مکان",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fa" dir="rtl">
      <body className={`${vazirmatn.variable} antialiased`}>{children}</body>
    </html>
  );
}
