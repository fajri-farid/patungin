"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  CloudOff,
  Loader2,
} from "lucide-react";
import ui from "./product/product.module.css";

export type SaveStatus = "idle" | "saving" | "saved" | "error";
type Step = "review" | "split" | "result";

interface StepHeaderProps {
  billId: string;
  title: string;
  merchant?: string;
  activeStep: Step;
  saveStatus?: SaveStatus;
  onRetrySave?: () => void;
  onBeforeNavigate?: () => Promise<boolean>;
}

const STEPS = [
  {
    key: "review",
    label: "Cek struk",
    title: "Cek struknya dulu.",
    description:
      "Periksa pesanan, harga, dan totalnya. Ubah jika ada yang belum sesuai.",
  },
  {
    key: "split",
    label: "Bagi pesanan",
    title: "Pilih siapa pesan apa.",
    description:
      "Tambahkan teman, lalu bagi pesanannya. Menu bareng bisa dibagi ke yang ikut makan.",
  },
  {
    key: "result",
    label: "Hasil",
    title: "Cek bagian tiap orang.",
    description:
      "Tambahkan tujuan pembayaran jika perlu, lalu simpan hasil untuk dibagikan ke teman.",
  },
] as const;

export function StepIntro({
  activeStep,
  completed = false,
}: {
  activeStep: Step;
  completed?: boolean;
}) {
  const index = STEPS.findIndex((step) => step.key === activeStep);
  const step = STEPS[index];
  return (
    <div className={ui.intro}>
      <h1>
        {completed && activeStep === "result"
          ? "Hitungannya beres."
          : step.title}
      </h1>
      <p>
        {completed && activeStep === "result"
          ? "Bagikan rinciannya. Teman tinggal cek bagian masing-masing."
          : step.description}
      </p>
    </div>
  );
}

export function StepHeader({
  billId,
  title,
  merchant,
  activeStep,
  saveStatus = "saved",
  onRetrySave,
  onBeforeNavigate,
}: StepHeaderProps) {
  const router = useRouter();
  const activeIndex = STEPS.findIndex((step) => step.key === activeStep);
  const navigate = async (
    event: React.MouseEvent<HTMLAnchorElement>,
    href: string,
  ) => {
    if (
      !onBeforeNavigate ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.button !== 0
    )
      return;
    event.preventDefault();
    if (await onBeforeNavigate()) router.push(href);
  };

  return (
    <header className={ui.stepHeader}>
      <a className={ui.skipLink} href="#bill-content">
        Langsung ke isi tagihan
      </a>
      <div className={ui.stepHeaderInner}>
        <div className={ui.stepTop}>
          <div className={ui.stepBill}>
            <Link
              href="/app"
              onClick={(event) => navigate(event, "/app")}
              className={ui.back}
              aria-label="Kembali ke tagihan saya"
            >
              <ArrowLeft size={18} aria-hidden="true" />
            </Link>
            <div className={ui.stepBillText}>
              <strong>{title || "Tagihan baru"}</strong>
              <p>{merchant || "Patungin · Bagi tagihan makan"}</p>
            </div>
          </div>
          <div role="status">
            {saveStatus === "saving" && (
              <span className={`${ui.saveStatus} ${ui.saving}`}>
                <Loader2 size={14} className={ui.spinner} aria-hidden="true" />
                Menyimpan…
              </span>
            )}
            {saveStatus === "saved" && (
              <span className={ui.saveStatus}>
                <CheckCircle2 size={14} aria-hidden="true" />
                Tersimpan
              </span>
            )}
            {saveStatus === "idle" && (
              <span className={`${ui.saveStatus} ${ui.saving}`}>
                Belum disimpan
              </span>
            )}
            {saveStatus === "error" &&
              (onRetrySave ? (
                <button
                  type="button"
                  onClick={onRetrySave}
                  className={`${ui.saveStatus} ${ui.saveError}`}
                >
                  <CloudOff size={14} aria-hidden="true" />
                  Coba simpan lagi
                </button>
              ) : (
                <span className={`${ui.saveStatus} ${ui.saveError}`}>
                  Belum tersimpan
                </span>
              ))}
          </div>
        </div>
        <nav className={ui.stepNav} aria-label="Langkah pembagian tagihan">
          {STEPS.map((step, index) => {
            const content = (
              <>
                <span className={ui.stepCount}>
                  {index < activeIndex ? (
                    <Check size={12} aria-hidden="true" />
                  ) : (
                    index + 1
                  )}
                </span>
                <span>{step.label}</span>
              </>
            );
            const href = `/bills/${billId}/${step.key}`;
            return index < activeIndex ? (
              <Link
                key={step.key}
                href={href}
                onClick={(event) => navigate(event, href)}
              >
                {content}
              </Link>
            ) : (
              <span
                key={step.key}
                aria-current={index === activeIndex ? "step" : undefined}
              >
                {content}
              </span>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
