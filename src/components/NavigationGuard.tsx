"use client";

import { createContext, useContext, useEffect, type ComponentProps, type ReactNode } from "react";
import Link from "next/link";

const NavigationContext = createContext<(() => boolean) | null>(null);

export function NavigationGuard({ dirty, busy, children }: {
  dirty: boolean;
  busy: boolean;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!dirty && !busy) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy]);

  function allowNavigation() {
    if (busy) return false;
    return !dirty || window.confirm("Perubahan belum tersimpan. Tinggalkan halaman dan buang perubahan?");
  }

  return <NavigationContext value={allowNavigation}>{children}</NavigationContext>;
}

/** onNavigate only guards same-tab SPA navigation, preserving modifier clicks. */
export function GuardedLink({ onNavigate, ...props }: ComponentProps<typeof Link>) {
  const allowNavigation = useContext(NavigationContext);
  return <Link {...props} onNavigate={(event) => {
    if (allowNavigation && !allowNavigation()) {
      event.preventDefault();
      return;
    }
    onNavigate?.(event);
  }} />;
}
