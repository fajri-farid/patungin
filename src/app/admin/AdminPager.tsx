import { ArrowLeft, ArrowRight } from "lucide-react";
import styles from "./admin.module.css";

export function AdminPager({
  next,
  hasPrevious,
  busy,
  onNext,
  onPrevious,
}: {
  next: string | null;
  hasPrevious: boolean;
  busy: boolean;
  onNext: () => void;
  onPrevious: () => void;
}) {
  return (
    <div className={styles.pagination}>
      <p>Maksimal 25 data per halaman.</p>
      <div>
        <button
          type="button"
          className={styles.secondaryButton}
          disabled={busy || !hasPrevious}
          onClick={onPrevious}
        >
          <ArrowLeft size={15} aria-hidden="true" /> Sebelumnya
        </button>
        <button
          type="button"
          className={styles.secondaryButton}
          disabled={busy || !next}
          onClick={onNext}
        >
          Berikutnya <ArrowRight size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
