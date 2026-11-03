"use client";

import { useRef, useState, type KeyboardEvent } from "react";
import { ReceiptText } from "lucide-react";
import { formatRupiah } from "@/domain/billing/money";
import styles from "./landing.module.css";

// One consistent illustrative bill: items 260,000 - discount 26,000
// + service and tax 36,270 = 270,270. This never creates a real bill.
const PEOPLE = [
  {
    id: "dimas",
    name: "Dimas",
    color: "#2855D9",
    discount: 7000,
    charges: 9765,
    total: 72765,
    lines: [
      { name: "Ayam bakar · 1 porsi", amount: 40000 },
      { name: "Gorengan · ¼ bagian", amount: 10000 },
      { name: "Kopi susu · 1 gelas", amount: 20000 },
    ],
  },
  {
    id: "sarah",
    name: "Sarah",
    color: "#157A58",
    discount: 7000,
    charges: 9765,
    total: 72765,
    lines: [
      { name: "Ayam bakar · 1 porsi", amount: 40000 },
      { name: "Gorengan · ¼ bagian", amount: 10000 },
      { name: "Kopi susu · 1 gelas", amount: 20000 },
    ],
  },
  {
    id: "budi",
    name: "Budi",
    color: "#B8560C",
    discount: 3000,
    charges: 4185,
    total: 31185,
    lines: [
      { name: "Gorengan · ¼ bagian", amount: 10000 },
      { name: "Kopi susu · 1 gelas", amount: 20000 },
    ],
  },
  {
    id: "alya",
    name: "Alya",
    color: "#BF215B",
    discount: 9000,
    charges: 12555,
    total: 93555,
    lines: [
      { name: "Pasta · 1 porsi", amount: 60000 },
      { name: "Gorengan · ¼ bagian", amount: 10000 },
      { name: "Kopi susu · 1 gelas", amount: 20000 },
    ],
  },
];

const MENU = [
  {
    name: "2 × Ayam bakar",
    amount: 80000,
    owners: "Dimas dan Sarah · masing-masing 1 porsi",
  },
  { name: "1 × Pasta", amount: 60000, owners: "Alya · 1 porsi" },
  {
    name: "1 × Gorengan",
    amount: 40000,
    owners: "Dimas, Sarah, Budi, dan Alya · dibagi 4",
  },
  {
    name: "4 × Kopi susu",
    amount: 80000,
    owners: "Semua · masing-masing 1 gelas",
  },
];

const TABS = [
  { id: "shares", label: "Bagian teman" },
  { id: "items", label: "Daftar menu" },
  { id: "whatsapp", label: "Pesan WhatsApp" },
] as const;
type PreviewTab = (typeof TABS)[number]["id"];

export function InteractiveReceiptPreview() {
  const [activeTab, setActiveTab] = useState<PreviewTab>("shares");
  const [personId, setPersonId] = useState("sarah");
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const person = PEOPLE.find((entry) => entry.id === personId) ?? PEOPLE[1];

  function handleTabKey(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % TABS.length;
    else if (event.key === "ArrowLeft")
      next = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = TABS.length - 1;
    else return;
    event.preventDefault();
    setActiveTab(TABS[next].id);
    tabRefs.current[next]?.focus();
  }

  return (
    <div
      id="contoh-hasil"
      className={styles.previewFrame}
      role="region"
      aria-label="Contoh interaktif pembagian tagihan"
    >
      <div className={styles.previewReceipt}>
        <div className={styles.receiptHeader}>
          <div>
            <strong>Makan bareng di kafe</strong>
            <p>4 orang · Ditalangi Dimas</p>
          </div>
          <span className={styles.receiptIcon}>
            <ReceiptText size={21} aria-hidden="true" />
          </span>
        </div>
        <div className={styles.receiptTotal}>
          <span>Total tagihan</span>
          <strong className="tabular-money">{formatRupiah(270270)}</strong>
        </div>
        <div
          className={styles.previewTabs}
          role="tablist"
          aria-label="Lihat contoh hasil Patungin"
        >
          {TABS.map((tab, index) => (
            <button
              key={tab.id}
              id={`preview-tab-${tab.id}`}
              type="button"
              role="tab"
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              aria-selected={activeTab === tab.id}
              aria-controls={`preview-panel-${tab.id}`}
              tabIndex={activeTab === tab.id ? 0 : -1}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(event) => handleTabKey(event, index)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div
          id="preview-panel-shares"
          role="tabpanel"
          aria-labelledby="preview-tab-shares"
          tabIndex={0}
          hidden={activeTab !== "shares"}
          className={styles.previewPanel}
        >
          <p className={styles.previewHint}>Pilih nama untuk cek bagiannya:</p>
          <div
            className={styles.personButtons}
            role="group"
            aria-label="Pilih teman"
          >
            {PEOPLE.map((entry) => (
              <button
                key={entry.id}
                type="button"
                aria-pressed={personId === entry.id}
                onClick={() => setPersonId(entry.id)}
              >
                <span className={styles.personName}>
                  <span
                    className={styles.personDot}
                    style={{ backgroundColor: entry.color }}
                    aria-hidden="true"
                  />
                  {entry.name}
                </span>
                <span className={`${styles.personAmount} tabular-money`}>
                  {formatRupiah(entry.total)}
                </span>
              </button>
            ))}
          </div>
          <div
            className={styles.personDetail}
            aria-live="polite"
            aria-atomic="true"
          >
            <div key={person.id} className={styles.personDetailContent}>
              <div className={styles.personDetailHeading}>
                <strong>Pesanan {person.name}</strong>
                <span>
                  {person.id === "dimas"
                    ? "Sudah bayar di kasir"
                    : "Transfer ke Dimas"}
                </span>
              </div>
              <dl>
                {person.lines.map((line) => (
                  <div key={line.name} className={styles.receiptRow}>
                    <dt>{line.name}</dt>
                    <dd>{formatRupiah(line.amount)}</dd>
                  </div>
                ))}
              </dl>
              <dl className={styles.receiptAdjustments}>
                <div className={`${styles.receiptRow} ${styles.receiptDiscount}`}>
                  <dt>Diskon</dt>
                  <dd>−{formatRupiah(person.discount)}</dd>
                </div>
                <div className={styles.receiptRow}>
                  <dt>Pajak + biaya layanan</dt>
                  <dd>+{formatRupiah(person.charges)}</dd>
                </div>
              </dl>
              <div className={styles.receiptPayable}>
                <span>
                  {person.id === "dimas"
                    ? "Bagian Dimas sendiri"
                    : `Bagian bayar ${person.name}`}
                </span>
                <strong className="tabular-money">
                  {formatRupiah(person.total)}
                </strong>
              </div>
            </div>
          </div>
        </div>

        <div
          id="preview-panel-items"
          role="tabpanel"
          aria-labelledby="preview-tab-items"
          tabIndex={0}
          hidden={activeTab !== "items"}
          className={styles.previewPanel}
        >
          <p className={styles.previewHint}>
            Pesanan pribadi dan menu yang dibagi bareng.
          </p>
          <ul aria-label="Daftar pesanan contoh">
            {MENU.map((item) => (
              <li key={item.name} className={styles.menuItem}>
                <div>
                  <span>{item.name}</span>
                  <strong className="tabular-money">
                    {formatRupiah(item.amount)}
                  </strong>
                </div>
                <p>{item.owners}</p>
              </li>
            ))}
          </ul>
        </div>

        <div
          id="preview-panel-whatsapp"
          role="tabpanel"
          aria-labelledby="preview-tab-whatsapp"
          tabIndex={0}
          hidden={activeTab !== "whatsapp"}
          className={styles.previewPanel}
        >
          <p className={styles.previewHint}>
            Contoh ringkasan yang bisa kamu kirim ke grup:
          </p>
          <div className={styles.messagePreview}>
            <strong>Patungan makan tadi, ya 👋</strong>
            <p>Total {formatRupiah(270270)}, ditalangi Dimas.</p>
            <ul>
              {PEOPLE.filter((entry) => entry.id !== "dimas").map((entry) => (
                <li key={entry.id}>
                  {entry.name}:{" "}
                  <strong className="tabular-money">
                    {formatRupiah(entry.total)}
                  </strong>{" "}
                  → Dimas
                </li>
              ))}
              <li>Dimas: {formatRupiah(72765)} (bagian sendiri)</li>
            </ul>
            <p>Transfer ke rekening yang Dimas cantumkan.</p>
            <small>
              Link rincian bisa disertakan agar teman bisa cek pesanannya.
            </small>
          </div>
        </div>
      </div>
    </div>
  );
}
