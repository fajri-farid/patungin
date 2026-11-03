"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { claimInviteAction } from "@/app/actions/access";
import { AppHeader } from "@/components/product/AppHeader";
import ui from "@/components/product/product.module.css";
import styles from "../admin/admin.module.css";

export function ActivationClient({
  email,
  canClaim,
}: {
  email: string;
  canClaim: boolean;
}) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  function logout() {
    startTransition(async () => {
      try {
        const response = await fetch("/api/auth/logout", { method: "POST" });
        if (!response.ok) throw new Error();
        router.replace("/login");
        router.refresh();
      } catch {
        setError("Belum bisa keluar. Coba lagi.");
      }
    });
  }
  return (
    <div className={ui.page}>
      <AppHeader
        hideNavigation
        email={email}
        onLogout={logout}
        pending={pending}
      />
      <main className={`${ui.main} ${styles.activation}`}>
        <section className={styles.card}>
          <p className={styles.eyebrow}>AKSES PATUNGIN</p>
          <h1>{canClaim ? "Punya undangan?" : "Akses akun belum tersedia."}</h1>
          <p>
            {canClaim
              ? "Masukkan kode dari admin untuk mulai membagi tagihan. Kamu mendapat 30 scan per bulan."
              : "Aksesmu dinonaktifkan atau sudah berakhir. Hubungi admin untuk mengaktifkannya kembali."}
          </p>
          <p className={styles.muted}>
            Masuk sebagai <strong>{email}</strong>
          </p>
          {error && (
            <p role="alert" className={ui.error}>
              {error}
            </p>
          )}
          {canClaim && (
            <form
              className={styles.form}
              onSubmit={(event) => {
                event.preventDefault();
                setError("");
                startTransition(async () => {
                  try {
                    const result = await claimInviteAction(code);
                    if (!result.ok) {
                      setError(result.error);
                      return;
                    }
                    router.replace("/app");
                    router.refresh();
                  } catch {
                    setError("Periksa koneksi dan coba lagi.");
                  }
                });
              }}
            >
              <label>
                Kode undangan
                <input
                  required
                  minLength={8}
                  maxLength={24}
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder="Contoh: MAKANBARENG"
                />
              </label>
              <button className={ui.primary} disabled={pending}>
                {pending ? "Memeriksa…" : "Aktifkan akses"}
              </button>
            </form>
          )}
          <button
            type="button"
            className={ui.secondary}
            disabled={pending}
            onClick={logout}
          >
            Gunakan akun Google lain
          </button>
        </section>
      </main>
    </div>
  );
}
