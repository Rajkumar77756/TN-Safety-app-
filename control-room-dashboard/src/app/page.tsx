"use client";
import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { io, Socket } from "socket.io-client";
import styles from "./page.module.css";

// Leaflet uses window and must be dynamically imported without SSR
const MapComponent = dynamic(() => import("../components/MapComponent"), {
  ssr: false,
  loading: () => <div className={styles.loading}>Initializing Secure Map...</div>,
});

export interface Incident {
  deviceUuid: string;
  incidentId: string;
  lat: number;
  lng: number;
  battery: number;
  timestamp: number;
  trustStatus: string;
  status: 'ACTIVE' | 'ANSWERED';
}

export default function Home() {
  const [time, setTime] = useState<string>("");
  const [incidents, setIncidents] = useState<Record<string, Incident>>({});
  const [socket, setSocket] = useState<Socket | null>(null);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [dispatcherNotes, setDispatcherNotes] = useState<string>("");

  useEffect(() => {
    // Start clock
    setTime(new Date().toLocaleTimeString());
    const interval = setInterval(() => {
      setTime(new Date().toLocaleTimeString());
    }, 1000);

    // Connect to the public Localtunnel Node.js backend
    const newSocket = io("https://womensafetybackend.loca.lt", {
      extraHeaders: {
        'Bypass-Tunnel-Reminder': 'true'
      }
    });
    setSocket(newSocket);

    // Listen for new or updated incident locations
    newSocket.on("incident_location_updated", (payload: any) => {
      setIncidents((prev) => {
        // If it's a completely new incident, default status to ACTIVE
        const existingStatus = prev[payload.incidentId]?.status || 'ACTIVE';
        return {
          ...prev,
          [payload.incidentId]: { ...payload, status: existingStatus },
        };
      });
    });

    // Listen for status changes (e.g. marked as answered by another dispatcher)
    newSocket.on("incident_status_changed", (payload: { incidentId: string, status: 'ACTIVE' | 'ANSWERED', notes: string }) => {
      setIncidents((prev) => {
        if (!prev[payload.incidentId]) return prev;
        return {
          ...prev,
          [payload.incidentId]: { ...prev[payload.incidentId], status: payload.status },
        };
      });
      if (payload.status === 'ANSWERED') {
        setSelectedIncidentId(null);
      }
    });

    return () => {
      clearInterval(interval);
      newSocket.disconnect();
    };
  }, []);

  const handleAnswerIncident = async (incidentId: string) => {
    try {
      await fetch(`http://localhost:4000/api/dispatch/incident/${incidentId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ANSWERED', notes: dispatcherNotes })
      });
      setDispatcherNotes("");
    } catch (e) {
      console.error("Failed to answer incident", e);
    }
  };

  // Convert dictionary to array and sort newest first
  const incidentList = Object.values(incidents).sort((a, b) => b.timestamp - a.timestamp);
  const selectedIncident = selectedIncidentId ? incidents[selectedIncidentId] : null;

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div className={styles.logo}>
          <div className={styles.pulseDot}></div>
          <h1>Offline Guardian // <span className={styles.subtitle}>Master Control</span></h1>
        </div>
        <div className={styles.status}>
          <span className={styles.statusOnline}>SYSTEM ONLINE</span>
          <span className={styles.time}>{time}</span>
        </div>
      </header>
      
      <div className={styles.mapContainer}>
        <div className={styles.mapOverlay}>
          <h2>Active Area Monitoring</h2>
          <p>Listening for Tier 1 Online & Tier 3 Mesh relay packets...</p>
        </div>
        <MapComponent incidents={incidents} />
      </div>

      {/* Instagram-style Incident Queue */}
      <div className={styles.sidebar}>
        <h3>Incoming Incidents</h3>
        
        {incidentList.length === 0 ? (
          <div className={styles.emptyState}>
            Waiting for SOS trigger...
          </div>
        ) : (
          <div className={styles.queueContainer}>
            {incidentList.map(incident => (
              <div 
                key={incident.incidentId} 
                className={`${styles.queueItem} ${selectedIncidentId === incident.incidentId ? styles.selected : ''}`}
                onClick={() => setSelectedIncidentId(incident.incidentId)}
              >
                <div className={`${styles.avatarRing} ${incident.status === 'ACTIVE' ? styles.activeRing : ''}`}>
                  <div className={styles.avatarInner}>
                    {incident.deviceUuid.substring(0,2).toUpperCase()}
                  </div>
                </div>
                <div className={styles.incidentDetails}>
                  <div className={styles.incidentHeader}>
                    <strong>ID: {incident.deviceUuid.substring(0,8)}</strong>
                    <span className={styles.queueTime}>{new Date(incident.timestamp).toLocaleTimeString()}</span>
                  </div>
                  <div className={styles.incidentSub}>
                    <span className={incident.status === 'ACTIVE' ? styles.statusActiveText : styles.statusAnsweredText}>
                      {incident.status}
                    </span>
                    {incident.trustStatus === 'NEEDS_REVIEW' && (
                      <span className={styles.flagWarning}> • FLAGGED</span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        
        {/* Action Panel for answering the selected incident */}
        {selectedIncident && selectedIncident.status === 'ACTIVE' && (
          <div className={styles.actionPanel}>
            <h4>Take Information</h4>
            <div className={styles.infoRow}>
              <span>Device:</span> {selectedIncident.deviceUuid.substring(0,8)}
            </div>
            <div className={styles.infoRow}>
              <span>Battery:</span> {selectedIncident.battery}%
            </div>
            <textarea 
              className={styles.notesInput}
              placeholder="Dispatcher notes (e.g., dispatching patrol unit 4)..."
              value={dispatcherNotes}
              onChange={(e) => setDispatcherNotes(e.target.value)}
            />
            <button 
              className={styles.answerButton}
              onClick={() => handleAnswerIncident(selectedIncident.incidentId)}
            >
              Mark as Answered
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
