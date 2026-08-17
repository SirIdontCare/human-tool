import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "human-tool | Human Capability as Infrastructure for AI Agents",
  description: "Give AI agents reliable programmatic access to human expertise, judgment, and verification.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased bg-[#090d16] text-slate-100 min-h-screen flex flex-col">
        {/* Navigation bar */}
        <header className="border-b border-slate-800/80 bg-slate-950/60 backdrop-blur-md sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white shadow-lg shadow-blue-500/30">
                H
              </div>
              <div>
                <a href="/" className="text-lg font-semibold tracking-tight text-white hover:text-blue-400 transition-colors">
                  human-tool
                </a>
                <span className="ml-2 text-xs font-mono px-2 py-0.5 rounded bg-blue-950 text-blue-400 border border-blue-800/50">
                  Sprint 1 MVP
                </span>
              </div>
            </div>
            <nav className="flex items-center space-x-4 text-sm font-medium">
              <a href="/" className="text-slate-300 hover:text-white transition-colors">
                Agent Sandbox & Demo
              </a>
              <a href="/api/catalogue" target="_blank" className="text-slate-400 hover:text-slate-200 transition-colors">
                Catalogue API
              </a>
              <a href="/api/events" target="_blank" className="text-slate-400 hover:text-slate-200 transition-colors">
                Audit Events
              </a>
            </nav>
          </div>
        </header>

        {/* Main Content */}
        <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
          {children}
        </main>

        {/* Footer */}
        <footer className="border-t border-slate-800/60 bg-slate-950/40 py-6 mt-12 text-center text-xs text-slate-500">
          <div className="max-w-7xl mx-auto px-4">
            human-tool — Human capability infrastructure for AI agents. Built strictly per Sprint 1 Specification.
          </div>
        </footer>
      </body>
    </html>
  );
}
