"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

const NAV_LINKS = [
  { href: "/chat", label: "채팅", isAnchor: false },
  { href: "/synthesis", label: "종합문서", isAnchor: false },
  { href: "/autocode", label: "자동코딩", isAnchor: false },
  { href: "/editor", label: "에디터", isAnchor: false },
  { href: "/channels", label: "채널", isAnchor: false },
  { href: "/mypage", label: "마이페이지", isAnchor: false },
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
