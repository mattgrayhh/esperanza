import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

// Geist is the dashboard typeface everywhere — body and headings alike.
// Exposes --font-geist; app/globals.css wires --font-sans -> --font-geist.
const geist = Geist({subsets:['latin'],variable:'--font-geist'});

export const metadata: Metadata = {
  title: 'Esperanza Admin',
  description: 'Esperanza Homes CMS admin — D1 + R2 on Cloudflare Workers.',
  robots: { index: false, follow: false },
};

// Admin is fully dynamic + auth-gated; never statically cache a page.
export const dynamic = 'force-dynamic';

// ROOT layout — the html/body shell ONLY. It deliberately renders NO app chrome
// and performs NO auth check: the authenticated sidebar lives in the (app) route
// group's layout (app/(app)/layout.tsx), and the signed-out /login page lives
// outside that group. Keeping the shell out of this shared root layout is what
// prevents a stale authenticated shell from persisting over the login form across
// client navigations (Next.js preserves shared layout segments between routes).
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={cn("font-sans", geist.variable)}>
      <body style={{ margin: 0 }}>{children}</body>
    </html>
  );
}
