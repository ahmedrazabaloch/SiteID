import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import styles from "./page.module.css";

export const metadata: Metadata = {
  title: "Download Search ID for Android",
  description: "Install Search ID on Android for quick tower lookups, including offline search after syncing.",
};

export default function DownloadPage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="Search ID home">
          <Image className={styles.brandIcon} src="/icon-192.png" alt="" width={42} height={42} priority />
          <span><strong>Search ID</strong><small>Tower Operations</small></span>
        </Link>
        <Link href="/" className={styles.backLink}>Back to Search ID</Link>
      </header>

      <section className={styles.hero}>
        <div className={styles.copy}>
          <span className={styles.eyebrow}>SEARCH ID FOR ANDROID</span>
          <h1>Your tower lookup,<br />ready on mobile.</h1>
          <p>Install Search ID on your Android phone for quick site and mobile DG lookups. Sync once while online to make saved site information available offline.</p>
          <a className={styles.downloadButton} href="/downloads/Search-ID.apk" download="Search-ID.apk">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/></svg>
            Download Android App <span className={styles.fileType}>APK</span>
          </a>
          <span className={styles.downloadHint}>Android app package · 1.2 MB</span>
        </div>

        <div className={styles.preview} aria-hidden="true">
          <div className={styles.phone}>
            <div className={styles.phoneTop}><span /><i /></div>
            <Image className={styles.appMark} src="/icon-192.png" alt="" width={49} height={49} />
            <strong>Search ID</strong><small>Tower Operations</small>
            <div className={styles.searchCard}><span>Site ID</span><b>1260</b><div>Find site <span>⌕</span></div></div>
            <div className={styles.resultCard}><span>F1 Zone</span><b>North Karachi</b><span>Day Vehicle Crew</span><b>Driver: Haji M. · Supervisor: Asif</b></div>
            <div className={styles.phoneNav}><i /><i /><i /></div>
          </div>
          <span className={styles.glow} />
        </div>
      </section>

      <section className={styles.install}>
        <div>
          <span className={styles.step}>01</span>
          <h2>Download and install</h2>
          <p>Open this page on your Android phone, tap Download Android App, then open the downloaded APK and follow Android’s install prompts.</p>
        </div>
        <div>
          <span className={styles.step}>02</span>
          <h2>Sign in and sync</h2>
          <p>Sign in while connected to the internet. Search ID syncs site, latest fueling and vehicle assignment data to this device.</p>
        </div>
        <div>
          <span className={styles.step}>03</span>
          <h2>Search offline</h2>
          <p>After a successful sync, look up saved site IDs and Mobile DG vans without a connection. Offline lookups are read-only.</p>
        </div>
      </section>

      <footer className={styles.footer}>
        <span>Designed &amp; developed by <a href="https://www.linkedin.com/in/ahmedrazabaloch" target="_blank" rel="noreferrer">Ahmed Raza</a></span>
        <span>Android app · Search ID</span>
      </footer>
    </main>
  );
}
