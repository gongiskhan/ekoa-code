import type { Metadata, Viewport } from "next";
import { Inter, Lora } from "next/font/google";
import "./globals.css";
import { ApiProvider } from "@/components/providers/api-provider";
import { UiProvider } from "@/components/providers/ui-provider";
import { getVerticalMetadataDescription } from "@/lib/verticals";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const lora = Lora({
  subsets: ["latin"],
  weight: ["500", "600"],
  variable: "--font-lora",
});

// The app is a local-first, auth-gated client dashboard: every meaningful page
// renders behind login, so static prerender adds nothing and a long-standing
// React-null-hooks crash class breaks `next build` on several client pages
// (documented pre-existing). Render everything per-request instead.
export const dynamic = "force-dynamic";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

// Server-safe: the description switches to the active vertical's copy via the
// build-time NEXT_PUBLIC_EKOA_VERTICAL env, falling back to the generic line.
export const metadata: Metadata = {
  title: "EKOA",
  description:
    getVerticalMetadataDescription(process.env.NEXT_PUBLIC_EKOA_VERTICAL) ??
    "Ekoa - plataforma de trabalho com IA",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Font variables live on <html> so @theme tokens (--font-display) resolve at
  // :root — declared on <body> they compute to empty there, and Lora silently
  // falls back to the sans font in every font-display consumer.
  return (
    <html
      lang="pt-PT"
      className={`${inter.variable} ${lora.variable}`}
      suppressHydrationWarning
    >
      <body className="font-sans antialiased">
        <UiProvider>
          <ApiProvider>{children}</ApiProvider>
        </UiProvider>
      </body>
    </html>
  );
}
