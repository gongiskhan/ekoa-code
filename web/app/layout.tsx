import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { ApiProvider } from "@/components/providers/api-provider";
import { UiProvider } from "@/components/providers/ui-provider";
import { getVerticalMetadataDescription } from "@/lib/verticals";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

// Display face (page titles, hero, login headline). Consumed by the
// --font-display token in globals.css via the --display-face variable, so
// swapping the face is a one-import change. NOTE: the variable must NOT sit
// inside the --font-display* namespace — a token that var()-references a
// variable prefixed by its own name is dropped by the Tailwind v4 theme
// compiler (the .font-display utility silently disappears).
const displayFont = Space_Grotesk({
  subsets: ["latin"],
  variable: "--display-face",
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
  // :root — declared on <body> they compute to empty there, and the display
  // face silently falls back to the sans font in every font-display consumer.
  return (
    <html
      lang="pt-PT"
      className={`${inter.variable} ${displayFont.variable}`}
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
