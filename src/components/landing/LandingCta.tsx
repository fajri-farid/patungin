import Link from "next/link";
import { ArrowRight } from "lucide-react";
import styles from "./landing.module.css";

export function LandingCta({
  light = false,
  compact = false,
  className = "",
  onClick,
}: {
  light?: boolean;
  compact?: boolean;
  className?: string;
  onClick?: () => void;
}) {
  return (
    <Link
      href="/app"
      onClick={onClick}
      className={`${styles.primaryButton} ${light ? styles.lightButton : ""} ${compact ? styles.compactButton : ""} ${className}`}
    >
      Coba bagi tagihan <ArrowRight size={18} aria-hidden="true" />
    </Link>
  );
}
