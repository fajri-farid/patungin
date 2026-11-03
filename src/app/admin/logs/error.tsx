"use client";
import Link from "next/link";
import styles from "../admin.module.css";
export default function LogsError({ reset }: { reset: () => void }) {
  return (
    <main className={styles.shell}>
      <section className={styles.panel}>
        <div className={styles.empty}>
          <h1>Log belum dapat dimuat</h1>
          <p>
            Periksa koneksi, izin database, dan indeks Firestore pada
            deployment.
          </p>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={reset}
          >
            Coba lagi
          </button>
          <Link
            href="/admin"
            prefetch={false}
            className={styles.secondaryButton}
          >
            Kembali ke admin
          </Link>
        </div>
      </section>
    </main>
  );
}
