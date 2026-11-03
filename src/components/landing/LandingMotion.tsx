"use client";

import { useEffect, useRef, type ReactNode } from "react";
import styles from "./landing.module.css";

/** Keep the page server-rendered; one observer handles all scroll entrances. */
export function LandingMotion({ children }: { children: ReactNode }) {
  const pageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const page = pageRef.current;
    if (!page || !("IntersectionObserver" in window)) return;

    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const targets = Array.from(
      page.querySelectorAll<HTMLElement>("[data-reveal]"),
    );
    let observer: IntersectionObserver | undefined;

    function revealAll() {
      observer?.disconnect();
      targets.forEach((target) => {
        target.removeAttribute("data-reveal-state");
      });
    }

    function start() {
      revealAll();
      if (preference.matches) return;

      observer = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            (entry.target as HTMLElement).dataset.revealState = "visible";
            observer?.unobserve(entry.target);
          });
        },
        { threshold: 0, rootMargin: "0px 0px -32px 0px" },
      );

      // Never hide content already on screen, including restored scroll positions.
      targets.forEach((target) => {
        if (target.getBoundingClientRect().top < window.innerHeight) return;
        target.dataset.revealState = "pending";
        observer?.observe(target);
      });
    }

    function handleFocus(event: FocusEvent) {
      if (!(event.target instanceof Element)) return;
      const target = event.target.closest<HTMLElement>("[data-reveal]");
      if (!target) return;
      target.dataset.revealState = "visible";
      observer?.unobserve(target);
    }

    start();
    preference.addEventListener("change", start);
    page.addEventListener("focusin", handleFocus);
    return () => {
      revealAll();
      preference.removeEventListener("change", start);
      page.removeEventListener("focusin", handleFocus);
    };
  }, []);

  return (
    <div ref={pageRef} className={styles.page}>
      {children}
    </div>
  );
}
