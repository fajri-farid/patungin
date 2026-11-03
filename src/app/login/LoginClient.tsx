"use client";

import Image from "next/image";
import Link from "next/link";
import React, { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signInWithPopup, signOut } from "firebase/auth";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Loader2,
  ReceiptText,
  Users,
} from "lucide-react";
import {
  getFirebaseClientAuth,
  isFirebaseClientConfigured,
} from "@/lib/firebase-client";
import {
  getGoogleLoginIssue,
  getSessionLoginIssue,
  type LoginIssue,
} from "@/lib/login-errors";
import styles from "./login.module.css";

interface LoginClientProps {
  isFirebaseConfigured: boolean;
  initialErrorCode?: string | null;
}

export function LoginClient({
  isFirebaseConfigured,
  initialErrorCode,
}: LoginClientProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const loginInProgress = useRef(false);
  const [issue, setIssue] = useState<LoginIssue | null>(
    initialErrorCode ? getSessionLoginIssue(initialErrorCode) : null,
  );

  const exchangeSession = async (idToken: string): Promise<boolean> => {
    try {
      const res = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      const data: unknown = await res.json().catch(() => null);

      if (
        !res.ok ||
        !data ||
        typeof data !== "object" ||
        !("ok" in data) ||
        data.ok !== true
      ) {
        const code =
          data &&
          typeof data === "object" &&
          "code" in data &&
          typeof data.code === "string"
            ? data.code
            : "SESSION_EXCHANGE_FAILED";
        setIssue(getSessionLoginIssue(code));
        return false;
      }

      router.replace("destination" in data && data.destination === "/activate" ? "/activate" : "/app");
      router.refresh();
      return true;
    } catch {
      setIssue(getSessionLoginIssue("NETWORK_ERROR"));
      return false;
    }
  };

  const runLogin = async () => {
    if (loginInProgress.current) return;
    loginInProgress.current = true;
    setIssue(null);
    setLoading(true);
    let auth: ReturnType<typeof getFirebaseClientAuth>["auth"] | undefined;
    let succeeded = false;
    try {
      if (!isFirebaseClientConfigured() || !isFirebaseConfigured) {
        setIssue(getSessionLoginIssue("CLIENT_NOT_CONFIGURED"));
        return;
      }
      const client = getFirebaseClientAuth();
      auth = client.auth;
      const { googleProvider } = client;
      const credential = await signInWithPopup(auth, googleProvider);
      const idToken = await credential.user.getIdToken(true);
      succeeded = await exchangeSession(idToken);
    } catch (error: unknown) {
      setIssue(getGoogleLoginIssue(error));
    } finally {
      if (auth) await signOut(auth).catch(() => undefined);
      if (!succeeded) {
        loginInProgress.current = false;
        setLoading(false);
      }
    }
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="Patungin, beranda">
          <span className={styles.brandIcon}>
            <ReceiptText size={19} aria-hidden="true" />
          </span>
          <span translate="no">Patungin</span>
        </Link>
        <Link href="/" className={styles.backLink}>
          <ArrowLeft size={16} aria-hidden="true" />
          Kembali ke beranda
        </Link>
      </header>

      <main className={styles.main}>
        <div className={styles.shell}>
          <aside
            className={styles.story}
            aria-label="Bagi tagihan bersama Patungin"
          >
            <p className={styles.eyebrow}>BAGI TAGIHAN TANPA RIBET</p>
            <p className={styles.storyTitle}>
              Makan bareng.
              <br />
              <span>
                Bayar sesuai
                <br />
                pesanan.
              </span>
            </p>
            <p className={styles.storyDescription}>
              Dari satu struk, jadi rincian yang jelas buat semua.
            </p>

            <div className={styles.receiptIllustration} aria-hidden="true">
              <div className={styles.receiptTop}>
                <span className={styles.receiptMark}>
                  <ReceiptText size={20} />
                </span>
                <div>
                  <strong>Makan siang bareng</strong>
                  <span>3 orang · 1 tagihan</span>
                </div>
              </div>
              <div className={styles.receiptTotal}>
                <span>Total tagihan</span>
                <strong>Rp180.000</strong>
              </div>
              <div className={styles.receiptPeople}>
                <div>
                  <span className={styles.person}>
                    <i />
                    Dimas
                  </span>
                  <strong>Rp72.000</strong>
                </div>
                <div>
                  <span className={styles.person}>
                    <i />
                    Sarah
                  </span>
                  <strong>Rp60.000</strong>
                </div>
                <div>
                  <span className={styles.person}>
                    <i />
                    Budi
                  </span>
                  <strong>Rp48.000</strong>
                </div>
              </div>
              <div className={styles.receiptDone}>
                <CheckCircle2 size={16} /> Semua kebagian, totalnya pas.
              </div>
            </div>
            <p className={styles.illustrationCaption}>
              Contoh pembagian tagihan
            </p>
          </aside>

          <section className={styles.signIn} aria-labelledby="login-heading">
            <div className={styles.signInContent}>
              <span className={styles.welcomeIcon}>
                <ReceiptText size={25} aria-hidden="true" />
              </span>
              <p className={styles.eyebrow}>YUK, MULAI PATUNGAN</p>
              <h1 id="login-heading">
                Masuk dulu,
                <br />
                lalu bagi tagihannya.
              </h1>
              <p className={styles.description}>
                Pakai akun Google untuk membuat tagihan dan menyimpan rincian
                patunganmu.
              </p>

              {issue && (
                <div role="alert" className={styles.error}>
                  <AlertTriangle size={18} aria-hidden="true" />
                  <div>
                    <p>{issue.message}</p>
                    <p>{issue.guidance}</p>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={() => runLogin()}
                disabled={loading}
                aria-busy={loading}
                className={styles.googleButton}
              >
                {loading ? (
                  <Loader2
                    size={20}
                    className={styles.spinner}
                    aria-hidden="true"
                  />
                ) : (
                  <Image
                    src="/google-g.png"
                    alt=""
                    width={20}
                    height={20}
                    unoptimized
                  />
                )}
                <span>{loading ? "Sedang masuk…" : "Masuk dengan Google"}</span>
                {!loading && <ArrowRight size={17} aria-hidden="true" />}
              </button>
              <p className={styles.buttonNote} role="status">
                {loading
                  ? "Selesaikan proses masuk di jendela Google."
                  : "Nggak perlu bikin kata sandi baru."}
              </p>

              <div className={styles.friendNote}>
                <span className={styles.friendIcon}>
                  <Users size={21} aria-hidden="true" />
                </span>
                <div>
                  <h2>Cukup kamu yang masuk.</h2>
                  <p>
                    Teman tinggal buka link untuk cek bagiannya. Tanpa akun,
                    tanpa install aplikasi.
                  </p>
                </div>
              </div>

              <Link href="/#cara-kerja" className={styles.helpLink}>
                Lihat cara pakainya dulu{" "}
                <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </div>
          </section>
        </div>
      </main>

      <footer className={styles.footer}>
        <p>
          <span translate="no">Patungin</span> · Makan bareng. Bayar sesuai
          pesanan.
        </p>
      </footer>
    </div>
  );
}
