import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Camera,
  Check,
  CheckCircle2,
  Coffee,
  ReceiptText,
  Share2,
  ShieldCheck,
  ShoppingBag,
  Users,
  UtensilsCrossed,
  Wallet,
} from "lucide-react";
import { LandingHeader } from "@/components/landing/LandingHeader";
import { InteractiveReceiptPreview } from "@/components/landing/InteractiveReceiptPreview";
import { LandingFaq } from "@/components/landing/LandingFaq";
import { LandingCta } from "@/components/landing/LandingCta";
import { LandingMotion } from "@/components/landing/LandingMotion";
import styles from "@/components/landing/landing.module.css";

const description =
  "Foto struk, pilih siapa pesan apa, lalu bagikan rincian ke grup. Patungin bantu bagi tagihan makan sesuai pesanan, lengkap dengan pajak dan diskon.";

export const metadata: Metadata = {
  title: { absolute: "Patungin — Makan bareng. Bayar sesuai pesanan." },
  description,
  openGraph: {
    title: "Makan bareng. Bayar sesuai pesanan. | Patungin",
    description,
    locale: "id_ID",
    type: "website",
    siteName: "Patungin",
  },
};

const STEPS = [
  {
    Icon: Camera,
    title: "Masukkan struknya",
    description:
      "Foto struk atau unggah screenshot pesanan. Cek menu dan harganya sebelum lanjut. Bisa juga isi manual.",
  },
  {
    Icon: Users,
    title: "Pilih siapa pesan apa",
    description:
      "Tambahkan nama teman, lalu bagi pesanannya. Untuk menu yang dimakan bareng, pilih siapa saja yang ikut makan.",
  },
  {
    Icon: Share2,
    title: "Bagikan ke grup",
    description:
      "Kirim ringkasan lewat WhatsApp atau bagikan link rincian. Teman bisa cek bagiannya dan salin nomor rekeningmu.",
  },
];

const USE_CASES = [
  {
    Icon: UtensilsCrossed,
    title: "Makan siang kantor",
    text: "Beda menu, tetap satu tagihan.",
  },
  {
    Icon: Coffee,
    title: "Ngopi bareng",
    text: "Kopi sendiri, camilan bisa berbagi.",
  },
  {
    Icon: ShoppingBag,
    title: "Pesan makan online",
    text: "Diskon dan ongkir ikut dibagi.",
  },
];

export default function LandingPage() {
  return (
    <LandingMotion>
      <a className={styles.skipLink} href="#konten-utama">
        Langsung ke isi halaman
      </a>
      <LandingHeader />

      <main id="konten-utama" tabIndex={-1}>
        <section className={styles.hero} aria-labelledby="hero-heading">
          <div className={`${styles.container} ${styles.heroGrid}`}>
            <div className={styles.heroCopy}>
              <p className={styles.eyebrow}>
                <ReceiptText size={16} aria-hidden="true" /> Bagi tagihan makan,
                tanpa ribet
              </p>
              <h1 id="hero-heading">
                Makan bareng.
                <br />
                <span>
                  Bayar sesuai
                  <br className={styles.desktopBreak} /> pesanan.
                </span>
              </h1>
              <p className={styles.heroDescription}>
                Foto struk, pilih siapa pesan apa, lalu bagikan rincian ke grup.
                Patungin bantu hitung bagian tiap orang, termasuk pajak dan
                diskon.
              </p>
              <div className={styles.heroActions}>
                <LandingCta />
                <a className={styles.secondaryButton} href="#contoh-hasil">
                  Lihat contohnya <ArrowRight size={17} aria-hidden="true" />
                </a>
              </div>
              <p className={styles.signInNote}>
                Masuk dengan Google untuk membuat tagihan.
              </p>
              <ul className={styles.heroChecks}>
                <li>
                  <Check size={16} aria-hidden="true" /> Tanpa install aplikasi
                </li>
                <li>
                  <Check size={16} aria-hidden="true" /> Teman nggak perlu login
                </li>
              </ul>
            </div>
            <div className={styles.heroPreview}>
              <div className={styles.previewIntro}>
                <span className={styles.eyebrow}>COBA CONTOHNYA</span>
                <span>4 teman. Pesanan beda-beda.</span>
              </div>
              <InteractiveReceiptPreview />
              <p className={styles.previewCaption}>
                Pilih nama teman untuk melihat rincian bagiannya. Ini contoh,
                ya.
              </p>
            </div>
          </div>
        </section>

        <div
          className={styles.occasions}
          aria-label="Bisa dipakai untuk berbagai momen makan bareng"
        >
          <div
            className={`${styles.container} ${styles.occasionsGrid}`}
            data-reveal="stagger"
          >
            {USE_CASES.map(({ Icon, title, text }) => (
              <div className={styles.occasion} key={title}>
                <Icon size={22} aria-hidden="true" />
                <div>
                  <strong>{title}</strong>
                  <p>{text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <section
          id="cara-kerja"
          className={styles.section}
          aria-labelledby="cara-kerja-heading"
        >
          <div className={styles.container}>
            <div className={styles.sectionHeading} data-reveal="up">
              <p className={styles.eyebrow}>CARA PAKAI</p>
              <h2 id="cara-kerja-heading">Satu struk. Tiga langkah. Beres.</h2>
              <p>Kamu yang atur pembagiannya. Patungin yang bantu hitung.</p>
            </div>
            <ol className={styles.steps} data-reveal="stagger">
              {STEPS.map(({ Icon, title, description }, index) => (
                <li key={title} className={styles.step}>
                  <div className={styles.stepTop}>
                    <span className={styles.stepNumber}>0{index + 1}</span>
                    <Icon size={24} aria-hidden="true" />
                  </div>
                  <h3>{title}</h3>
                  <p>{description}</p>
                </li>
              ))}
            </ol>
            <div className={styles.sectionLink}>
              <a href="#contoh-hasil">
                Lihat contoh hasilnya dulu{" "}
                <ArrowRight size={17} aria-hidden="true" />
              </a>
            </div>
          </div>
        </section>

        <section
          id="keunggulan"
          className={`${styles.section} ${styles.benefitsSection}`}
          aria-labelledby="keunggulan-heading"
        >
          <div className={styles.container}>
            <div className={styles.benefitIntro} data-reveal="up">
              <div>
                <p className={styles.eyebrow}>
                  HITUNGANNYA JELAS, SEMUA NYAMAN
                </p>
                <h2 id="keunggulan-heading">
                  Cuma pesan kopi?
                  <br />
                  Bayarnya juga beda.
                </h2>
              </div>
              <p>
                Pajak, biaya layanan, dan diskon dibagi sesuai pesanan
                masing-masing. Jadi, setiap orang tahu apa yang dibayar.
              </p>
            </div>
            <div className={styles.benefitGrid} data-reveal="stagger">
              <article className={styles.sharingCard}>
                <div className={styles.featureIcon}>
                  <Users size={22} aria-hidden="true" />
                </div>
                <h3>Menu bareng, dibagi ke yang ikut makan.</h3>
                <p>
                  Gorengan untuk satu meja? Pilih nama yang ikut makan. Pesanan
                  pribadi tetap dihitung sendiri.
                </p>
                <div
                  className={styles.sharedExample}
                  aria-label="Contoh gorengan dibagi ke empat orang"
                >
                  <div className={styles.sharedExampleTitle}>
                    <span>Gorengan untuk berbagi</span>
                    <strong className="tabular-money">Rp40.000</strong>
                  </div>
                  <div className={styles.sharedPeople}>
                    {["Dimas", "Sarah", "Budi", "Alya"].map((name) => (
                      <span key={name}>{name}</span>
                    ))}
                  </div>
                  <div className={styles.sharedExampleTotal}>
                    <CheckCircle2 size={16} aria-hidden="true" /> Masing-masing
                    Rp10.000 sebelum pajak
                  </div>
                </div>
              </article>
              <article className={styles.linkCard}>
                <div className={styles.featureIcon}>
                  <Share2 size={22} aria-hidden="true" />
                </div>
                <h3>
                  Kirim linknya.
                  <br />
                  Teman tinggal cek.
                </h3>
                <p>
                  Rincian pesanan dan jumlah bayar bisa dibuka langsung dari
                  chat. Teman nggak perlu daftar akun.
                </p>
                <div
                  className={styles.chatExample}
                  aria-label="Contoh pesan pembagian tagihan"
                >
                  <span>Patungan makan tadi, ya 👋</span>
                  <div>
                    <ReceiptText size={21} aria-hidden="true" />
                    <div>
                      <strong>Rincian makan bareng</strong>
                      <span>Pesanan, bagian bayar, dan rekening</span>
                    </div>
                    <ArrowRight size={16} aria-hidden="true" />
                  </div>
                </div>
              </article>
            </div>
            <div className={styles.reassuranceGrid} data-reveal="stagger">
              <div>
                <Wallet size={21} aria-hidden="true" />
                <div>
                  <h3>Rekeningnya sekalian</h3>
                  <p>
                    Cantumkan rekening atau e-wallet agar teman mudah transfer.
                  </p>
                </div>
              </div>
              <div>
                <ShieldCheck size={21} aria-hidden="true" />
                <div>
                  <h3>Cek dulu, baru bagikan</h3>
                  <p>
                    Periksa dan ubah hasil baca struk sebelum menghitung bagian
                    teman.
                  </p>
                </div>
              </div>
              <div>
                <CheckCircle2 size={21} aria-hidden="true" />
                <div>
                  <h3>Totalnya tetap pas</h3>
                  <p>
                    Jumlah semua bagian sesuai dengan total tagihan yang kamu
                    cek.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <LandingFaq />

        <section
          className={styles.finalSection}
          aria-labelledby="mulai-heading"
        >
          <div className={styles.finalCard} data-reveal="up">
            <div className={styles.finalIcon}>
              <ReceiptText size={28} aria-hidden="true" />
            </div>
            <p className={styles.eyebrow}>STRUKNYA MASIH ADA?</p>
            <h2 id="mulai-heading">Yuk, bereskan patungannya.</h2>
            <p>
              Mulai dari satu struk. Biar semua tahu bagiannya,
              <br className={styles.desktopBreak} /> dan kamu nggak perlu hitung
              satu-satu.
            </p>
            <LandingCta light />
            <span className={styles.finalNote}>
              Masuk dengan Google · Teman cukup buka link
            </span>
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div className={styles.container}>
          <div className={styles.footerTop}>
            <div>
              <Link
                className={styles.brand}
                href="/"
                aria-label="Patungin, beranda"
              >
                <span className={styles.brandIcon}>
                  <ReceiptText size={19} aria-hidden="true" />
                </span>
                <span translate="no">Patungin</span>
              </Link>
              <p>Makan bareng. Bayar sesuai pesanan.</p>
            </div>
            <nav className={styles.footerNav} aria-label="Navigasi footer">
              <a href="#cara-kerja">Cara pakai</a>
              <a href="#keunggulan">Manfaat</a>
              <a href="#faq">Tanya jawab</a>
              <Link href="/login">
                Masuk <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </nav>
          </div>
          <div className={styles.footerBottom}>
            <p>© {new Date().getFullYear()} Patungin</p>
            <p>Dari meja makan, sampai hitungan beres.</p>
          </div>
        </div>
      </footer>
    </LandingMotion>
  );
}
