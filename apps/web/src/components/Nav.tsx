"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

const NAV_LINKS = [
  { href: "/chat", label: "\uD83D\uDCAC \uCC44\uD305", isAnchor: false },
  { href: "#features", label: "\uAE30\uB2A5", isAnchor: true },
  { href: "/channels", label: "\uCC44\uB110", isAnchor: false },
  { href: "/use-cases", label: "\uC0AC\uC6A9\uC0AC\uB840", isAnchor: false },
  { href: "/community", label: "\uCEE4\uBBA4\uB2C8\uD2F0", isAnchor: false },
  { href: "/mypage", label: "\uB9C8\uC774\uD398\uC774\uC9C0", isAnchor: false },
  { href: "#download", label: "\uB2E4\uC6B4\uB85C\uB4DC", isAnchor: true },
];

export default function Nav() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      className="nav"
      style={{
        borderBottomColor: scrolled ? "var(--border)" : "transparent",
      }}
    >
      <div className="nav-inner">
        <Link href="/" className="nav-logo">
          MoA
        </Link>

        <ul className={`nav-links${open ? " open" : ""}`}>
          {NAV_LINKS.map((link) => (
            <li key={link.href}>
              {link.isAnchor ? (
                <a href={link.href} onClick={() => setOpen(false)}>
                  {link.label}
                </a>
              ) : (
                <Link href={link.href} onClick={() => setOpen(false)}>
                  {link.label}
                </Link>
              )}
            </li>
          ))}
        </ul>

        <button
          className="nav-mobile-toggle"
          onClick={() => setOpen(!open)}
          aria-label="메뉴 열기"
        >
          {open ? "\u2715" : "\u2630"}
        </button>
      </div>
    </nav>
  );
}
