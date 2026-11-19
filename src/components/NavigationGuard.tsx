"use client";

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "./ConfirmDialog";

interface PendingNavigation {
  href: ComponentProps<typeof Link>["href"];
  replace?: boolean;
  scroll?: boolean;
  onConfirmNavigate?: () => void;
}

const NavigationContext = createContext<
  ((pending: PendingNavigation) => boolean) | null
>(null);

function resolveHref(href: ComponentProps<typeof Link>["href"]): string {
  if (typeof href === "string") return href;
  const pathname = href.pathname ?? "";
  let query = "";
  if (typeof href.query === "string") {
    query = href.query.startsWith("?") ? href.query : `?${href.query}`;
  } else if (href.query && typeof href.query === "object") {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(href.query)) {
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item != null) params.append(key, String(item));
        }
      } else if (value != null) {
        params.append(key, String(value));
      }
    }
    const serialized = params.toString();
    if (serialized) query = `?${serialized}`;
  }
  const hash = href.hash
    ? href.hash.startsWith("#")
      ? href.hash
      : `#${href.hash}`
    : "";
  return `${pathname}${query}${hash}` || "/";
}

export function NavigationGuard({
  dirty,
  busy,
  children,
}: {
  dirty: boolean;
  busy: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const [pendingNav, setPendingNav] = useState<PendingNavigation | null>(null);

  useEffect(() => {
    if (!dirty && !busy) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy]);

  function requestNavigation(pending: PendingNavigation): boolean {
    if (busy) return false;
    if (!dirty) return true;
    setPendingNav(pending);
    return false;
  }

  return (
    <NavigationContext value={requestNavigation}>
      {children}
      <ConfirmDialog
        open={pendingNav !== null}
        title="Tinggalkan halaman ini?"
        description="Perubahan yang baru kamu buat belum tersimpan. Kalau keluar sekarang, isianmu akan hilang."
        confirmLabel="Tinggalkan halaman"
        cancelLabel="Tetap di sini"
        tone="danger"
        onCancel={() => setPendingNav(null)}
        onConfirm={() => {
          if (!pendingNav) return;
          const target = resolveHref(pendingNav.href);
          const { replace, scroll, onConfirmNavigate } = pendingNav;
          setPendingNav(null);
          onConfirmNavigate?.();
          if (replace) {
            router.replace(target, scroll !== undefined ? { scroll } : undefined);
          } else {
            router.push(target, scroll !== undefined ? { scroll } : undefined);
          }
        }}
      />
    </NavigationContext>
  );
}

/** onNavigate only guards same-tab SPA navigation, preserving modifier clicks. */
export function GuardedLink({
  onNavigate,
  ...props
}: ComponentProps<typeof Link>) {
  const requestNavigation = useContext(NavigationContext);
  return (
    <Link
      {...props}
      onNavigate={(event) => {
        if (
          requestNavigation &&
          !requestNavigation({
            href: props.href,
            replace: props.replace,
            scroll: props.scroll,
            onConfirmNavigate: onNavigate ? () => onNavigate(event) : undefined,
          })
        ) {
          event.preventDefault();
          return;
        }
        onNavigate?.(event);
      }}
    />
  );
}
