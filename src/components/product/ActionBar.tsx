import { ArrowRight, Loader2 } from "lucide-react";
import ui from "./product.module.css";

export function ActionBar({
  title,
  detail,
  label,
  pending = false,
  disabled = false,
  onClick,
}: {
  title: string;
  detail: string;
  label: string;
  pending?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <div className={ui.actionBar}>
      <div className={ui.actionBarInner}>
        <div className={ui.actionBarText} role="status">
          <strong>{title}</strong>
          <span>{detail}</span>
        </div>
        <button
          type="button"
          className={ui.primary}
          onClick={onClick}
          disabled={disabled || pending}
          aria-busy={pending}
        >
          {pending && (
            <Loader2 size={17} className={ui.spinner} aria-hidden="true" />
          )}
          {pending ? "Menyimpan…" : label}
          {!pending && <ArrowRight size={17} aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}
