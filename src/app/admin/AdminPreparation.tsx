"use client";

import { useState, useTransition } from "react";
import { prepareAdminAccountsAction } from "@/app/actions/admin";
import styles from "./admin.module.css";

export function AdminPreparation({ onPrepared }: { onPrepared: () => void }) {
  const [pending, startTransition] = useTransition();
  const [cursor, setCursor] = useState<string | undefined>();
  const [count, setCount] = useState(0);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <details className={styles.preparation}>
      <summary>Persiapan akun lama & ringkasan bulan ini</summary>
      <p>
        Jalankan setelah memasang fitur ini untuk melengkapi pencarian nama dan
        peringatan kuota akun lama. Ulangi awal bulan jika ada akun dengan jatah
        dasar maksimal 5 yang belum scan. Setiap langkah memproses maksimal 25
        akun; akses dan kuota tidak diubah.
      </p>
      <p role="status">
        {done
          ? `Selesai. ${count} akun diperiksa.`
          : count
            ? `${count} akun diperiksa. Masih ada akun berikutnya.`
            : "Belum dijalankan dalam sesi ini."}
      </p>
      {error && (
        <p role="alert" className={styles.errorNote}>
          {error}
        </p>
      )}
      <button
        type="button"
        className={styles.secondaryButton}
        disabled={pending || done}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            try {
              const result = await prepareAdminAccountsAction(cursor);
              if (!result.ok) {
                setError(result.error);
                return;
              }
              setCount((value) => value + result.data.count);
              setCursor(result.data.next ?? undefined);
              setDone(!result.data.next);
              if (!result.data.next) onPrepared();
            } catch {
              setError("Persiapan belum berhasil. Coba langkah ini lagi.");
            }
          });
        }}
      >
        {pending
          ? "Memproses…"
          : done
            ? "Persiapan selesai"
            : count
              ? "Lanjutkan 25 akun berikutnya"
              : "Proses hingga 25 akun"}
      </button>
    </details>
  );
}
