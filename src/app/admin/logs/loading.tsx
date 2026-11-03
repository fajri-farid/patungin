import styles from "../admin.module.css";
export default function LogsLoading() {
  return (
    <main className={styles.shell}>
      <section className={styles.panel}>
        <div className={styles.empty} role="status">
          <h1>Memuat log aktivitas…</h1>
          <p>Mengambil catatan untuk kategori yang dibuka.</p>
        </div>
      </section>
    </main>
  );
}
