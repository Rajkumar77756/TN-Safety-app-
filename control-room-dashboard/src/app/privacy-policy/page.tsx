"use client";
import React, { useEffect, useState } from "react";
import styles from "../page.module.css";
import Link from "next/link";

export default function PrivacyPolicy() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');

  // Basic theme toggle
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <div className={styles.container} style={{ backgroundColor: theme === 'dark' ? '#0a0a0a' : '#f5f5f5', color: theme === 'dark' ? '#ededed' : '#111', overflowY: 'auto' }}>
      <nav className={styles.navbar} style={{ backgroundColor: theme === 'dark' ? '#111' : '#fff', borderBottomColor: theme === 'dark' ? '#333' : '#ddd' }}>
        <div className={styles.navLeft}>
           <h1 className={styles.navTitle} style={{ color: theme === 'dark' ? '#fff' : '#000' }}>Offline Guardian <span className={styles.navSubtitle}>// Privacy Policy</span></h1>
        </div>
        <div className={styles.navRight}>
           <button 
             onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
             style={{ padding: '8px 16px', background: theme === 'dark' ? '#333' : '#e0e0e0', color: theme === 'dark' ? '#fff' : '#000', borderRadius: '4px', border: 'none', cursor: 'pointer' }}
           >
             Toggle {theme === 'dark' ? 'Light' : 'Dark'} Mode
           </button>
           <Link href="/" style={{ color: '#ff4d4f', textDecoration: 'none', marginLeft: '1rem' }}>Back to Dashboard</Link>
        </div>
      </nav>
      
      <main style={{ padding: '3rem', maxWidth: '800px', margin: '0 auto' }}>
        <h1 style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>Privacy Policy for Control Room</h1>
        <p style={{ color: '#888', marginBottom: '2rem' }}>Last updated: {new Date().toLocaleDateString()}</p>
        
        <section style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem', borderBottom: `1px solid ${theme === 'dark' ? '#333' : '#ddd'}`, paddingBottom: '0.5rem' }}>1. Data Collection and Usage</h2>
          <p style={{ lineHeight: '1.6' }}>
            The Master Control Room dashboard collects and processes real-time location data, incident reports, and audio recordings from active SOS triggers. This information is strictly used for dispatching emergency services and coordinating law enforcement response.
          </p>
        </section>

        <section style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem', borderBottom: `1px solid ${theme === 'dark' ? '#333' : '#ddd'}`, paddingBottom: '0.5rem' }}>2. Officer Verification</h2>
          <p style={{ lineHeight: '1.6' }}>
            Law enforcement officer data, including badge numbers and contact information, is collected to verify identity before granting access to sensitive dispatch streams. This ensures the integrity of the response network.
          </p>
        </section>

        <section style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem', borderBottom: `1px solid ${theme === 'dark' ? '#333' : '#ddd'}`, paddingBottom: '0.5rem' }}>3. Data Retention</h2>
          <p style={{ lineHeight: '1.6' }}>
            Incident records, including historical heatmaps and resolved SOS alerts, are retained securely for audit and predictive AI analysis. All data is encrypted at rest and in transit.
          </p>
        </section>
        
        <section style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem', borderBottom: `1px solid ${theme === 'dark' ? '#333' : '#ddd'}`, paddingBottom: '0.5rem' }}>4. Access Control</h2>
          <p style={{ lineHeight: '1.6' }}>
            Access to this dashboard is restricted to authorized dispatcher personnel only. Unauthorized access attempts are logged and reported.
          </p>
        </section>
      </main>
    </div>
  );
}
