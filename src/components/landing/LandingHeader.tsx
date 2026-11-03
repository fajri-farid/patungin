"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight, LogIn, Menu, ReceiptText, X } from "lucide-react";
import { LandingCta } from "./LandingCta";
import styles from "./landing.module.css";

const NAV_LINKS = [
  { href: "#contoh-hasil", label: "Contoh hasil" },
  { href: "#cara-kerja", label: "Cara pakai" },
  { href: "#keunggulan", label: "Manfaat" },
  { href: "#faq", label: "Tanya jawab" },
];

export function LandingHeader() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);

  // Close menu on desktop resize and lock body scroll on mobile
  useEffect(() => {
    if (!mobileMenuOpen) return;

    const handleResize = () => {
      if (window.innerWidth > 900) {
        setMobileMenuOpen(false);
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("resize", handleResize);

    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("resize", handleResize);
    };
  }, [mobileMenuOpen]);

  return (
    <>
      <header
        className={styles.header}
        onKeyDown={(event) => {
          if (event.key === "Escape" && mobileMenuOpen) {
            setMobileMenuOpen(false);
            menuButton.current?.focus();
          }
        }}
      >
        <div className={`${styles.container} ${styles.headerInner}`}>
          <Link href="/" className={styles.brand} aria-label="Patungin, beranda">
            <span className={styles.brandIcon}>
              <ReceiptText size={19} aria-hidden="true" />
            </span>
            <span translate="no">Patungin</span>
          </Link>
          <nav aria-label="Navigasi utama" className={styles.desktopNav}>
            {NAV_LINKS.map((link) => (
              <a key={link.href} href={link.href}>
                {link.label}
              </a>
            ))}
          </nav>
          <div className={styles.headerActions}>
            <Link href="/login" className={styles.loginLink}>
              Masuk
            </Link>
            <div className={styles.headerDesktopCta}>
              <LandingCta compact />
            </div>
            <button
              ref={menuButton}
              type="button"
              className={styles.menuButton}
              onClick={() => setMobileMenuOpen((open) => !open)}
              aria-expanded={mobileMenuOpen}
              aria-controls="landing-mobile-nav"
              aria-label={
                mobileMenuOpen ? "Tutup menu navigasi" : "Buka menu navigasi"
              }
            >
              {mobileMenuOpen ? (
                <X size={21} aria-hidden="true" />
              ) : (
                <Menu size={21} aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        <nav
          id="landing-mobile-nav"
          aria-label="Navigasi seluler"
          className={styles.mobileNav}
          hidden={!mobileMenuOpen}
        >
          <div className={styles.mobileNavInner}>
            <div className={styles.mobileNavLinks}>
              {NAV_LINKS.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className={styles.mobileNavLink}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <span>{link.label}</span>
                  <ChevronRight
                    size={16}
                    className={styles.navChevron}
                    aria-hidden="true"
                  />
                </a>
              ))}
            </div>

            <div className={styles.mobileNavDivider} />

            <div className={styles.mobileNavActions}>
              <LandingCta
                className={styles.mobileCtaButton}
                onClick={() => setMobileMenuOpen(false)}
              />
              <Link
                href="/login"
                className={styles.mobileLoginButton}
                onClick={() => setMobileMenuOpen(false)}
              >
                <LogIn size={16} aria-hidden="true" />
                <span>Masuk ke akun</span>
              </Link>
            </div>
          </div>
        </nav>
      </header>

      {mobileMenuOpen && (
        <div
          className={styles.mobileBackdrop}
          onClick={() => setMobileMenuOpen(false)}
          aria-hidden="true"
        />
      )}
    </>
  );
}
