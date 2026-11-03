import { diagnoseScan } from "@/domain/diagnostics";
import type { AdminScanActivity } from "@/server/admin/monitoring";
import styles from "./admin.module.css";

export function ScanExplanation({
  scan,
  now,
  compact = false,
}: {
  scan: AdminScanActivity;
  now: number;
  compact?: boolean;
}) {
  const reason = diagnoseScan(scan, now);
  if (compact) return <small className={styles.cellNote}>{reason.title}</small>;
  return (
    <section
      className={styles.explanation}
      data-level={reason.level}
      aria-label="Penjelasan hasil scan"
    >
      <strong>{reason.title}</strong>
      <p>{reason.explanation}</p>
      <dl>
        <div>
          <dt>Dampak</dt>
          <dd>{reason.impact}</dd>
        </div>
        <div>
          <dt>Langkah berikutnya</dt>
          <dd>{reason.action}</dd>
        </div>
      </dl>
      <code>{reason.flag}</code>
    </section>
  );
}
