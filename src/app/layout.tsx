import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Bell, Inbox, ScrollText, Settings } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: "Review Assistant",
  description: "Self-hosted purchase review assistant",
  manifest: "/manifest.webmanifest"
};

export const viewport: Viewport = {
  themeColor: "#f7f5ee"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem('theme');if(t==='dark')document.documentElement.dataset.theme='dark';}catch(e){}` }} />
      </head>
      <body>
        <script dangerouslySetInnerHTML={{ __html: `if('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');` }} />
        <div className="shell">
          <aside className="sidebar">
            <Link className="brand" href="/">
              <span className="brand-mark">RA</span>
              <span>Review Assistant</span>
            </Link>
            <div className="sidebar-nav-wrap">
              <nav>
                <Link href="/">
                  <Inbox size={18} /> Queue
                </Link>
                <Link href="/reviews">
                  <Bell size={18} /> Reviews
                </Link>
                <Link href="/logs">
                  <ScrollText size={18} /> Logs
                </Link>
                <Link href="/settings">
                  <Settings size={18} /> Settings
                </Link>
              </nav>
              <ThemeToggle />
            </div>
          </aside>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
