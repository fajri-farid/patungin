import { ChevronDown } from "lucide-react";
import styles from "./landing.module.css";

const FAQ_LIST = [
  {
    question: "Siapa yang perlu masuk akun?",
    answer:
      "Cukup kamu yang membuat tagihan, lewat akun Google. Teman yang menerima link bisa langsung membuka rincian di browser HP, tanpa login atau install aplikasi.",
  },
  {
    question: "Kalau nggak ada foto struk, tetap bisa?",
    answer:
      "Bisa. Isi nama menu dan harganya secara manual. Kalau ada struk kertas atau screenshot pesanan online, kamu bisa unggah untuk membantu mengisi daftar menu. Tetap cek hasilnya sebelum lanjut, ya.",
  },
  {
    question: "Pajak, biaya layanan, dan diskonnya dibagi gimana?",
    answer:
      "Pembagiannya mengikuti nilai pesanan tiap orang. Kamu bisa memeriksa biaya, diskon, dan totalnya sebelum membagikan hasil. Pembulatan juga diatur supaya jumlah semua bagian tetap sesuai total tagihan.",
  },
  {
    question: "Bisa membagi menu yang dimakan bareng?",
    answer:
      "Bisa. Pilih siapa saja yang ikut makan menu itu, lalu harganya dibagi ke mereka. Pesanan pribadi tetap masuk ke bagian masing-masing. Kalau semua pesanannya mau dibagi rata, ada pilihan itu juga.",
  },
  {
    question: "Teman bisa langsung bayar lewat Patungin?",
    answer:
      "Teman bisa melihat jumlah bayar dan menyalin nomor rekening atau e-wallet yang kamu cantumkan. Transfernya dilakukan lewat aplikasi bank atau e-wallet masing-masing. Patungin membantu menghitung dan membagikan rinciannya.",
  },
  {
    question: "Apa saja yang terlihat saat link dibagikan?",
    answer:
      "Siapa pun yang punya link bisa melihat nama peserta, pesanan, rincian pembagian, dan info pembayaran yang kamu cantumkan. Jika fitur foto sementara tersedia, foto hanya ikut saat kamu memilih dan masa aksesnya masih berlaku: 24 jam sejak unggah. Email akun tidak ditampilkan. Bagikan link hanya ke orang yang perlu melihatnya.",
  },
];

export function LandingFaq() {
  return (
    <section id="faq" className={styles.section} aria-labelledby="faq-heading">
      <div className={`${styles.container} ${styles.faqGrid}`}>
        <div className={styles.faqIntro} data-reveal="up">
          <p className={styles.eyebrow}>TANYA JAWAB</p>
          <h2 id="faq-heading">
            Sebelum mulai,
            <br />
            ini yang perlu kamu tahu.
          </h2>
          <p>Soal akun, hitungan, sampai cara teman membayar.</p>
        </div>
        <div className={styles.faqList} data-reveal="stagger">
          {FAQ_LIST.map((item, index) => (
            <details
              className={styles.faqItem}
              key={item.question}
              name="landing-faq"
              open={index === 0}
            >
              <summary>
                {item.question}
                <ChevronDown size={19} aria-hidden="true" />
              </summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
