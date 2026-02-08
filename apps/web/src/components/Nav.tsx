"use client";

import { useState, useEffect } from "react";

const NAV_LINKS = [
  { href: "#features", label: "기능" },
  { href: "#how-it-works", label: "사용법" },
  { href: "#use-cases", label: "사용사례" },
  { href: "#skills", label: "스킬" },
  { href: "#channels", label: "채널" },
  { href: "#download", label: "다운로드" },
  { href: "https://discord.gg/moa-community", label: "커뮤니티" },
  { href: "https://github.com/lawith/moa/issues", label: "건의사항" },
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
        <a href="#" className="nav-logo">
          MoA
        </a>

        <ul className={`nav-links${open ? " open" : ""}`}>
          {NAV_LINKS.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                onClick={() => setOpen(false)}
                {...(link.href.startsWith("http")
                  ? { target: "_blank", rel: "noopener noreferrer" }
                  : {})}
              >
                {link.label}
              </a>
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
