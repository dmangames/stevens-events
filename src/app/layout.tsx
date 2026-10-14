import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Steven's Events",
  description: "Book tickets for Steven's events.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-slate-900">
        {children}
        <footer className="mx-auto mt-16 flex max-w-3xl gap-4 px-8 pb-8 text-sm text-slate-500 print:hidden">
          <Link href="/privacy" className="underline">Privacy policy</Link>
          <Link href="/refund-policy" className="underline">Refund policy</Link>
        </footer>
      </body>
    </html>
  );
}
