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
  district?: string | null;
  battery: number;
  timestamp: number;
  trustStatus: string;
  status: 'ACTIVE' | 'ANSWERED' | 'CANCELLED_BY_USER';
}

const SERVER_URL = "https://tn-safety-app.onrender.com";

const TAMIL_NADU_DISTRICTS = [
  "Ariyalur", "Chengalpattu", "Chennai", "Coimbatore", "Cuddalore",
  "Dharmapuri", "Dindigul", "Erode", "Kallakurichi", "Kanchipuram",
  "Kanyakumari", "Karur", "Krishnagiri", "Madurai", "Mayiladuthurai",
  "Nagapattinam", "Namakkal", "Nilgiris", "Perambalur", "Pudukkottai",
  "Ramanathapuram", "Ranipet", "Salem", "Sivaganga", "Tenkasi",
  "Thanjavur", "Theni", "Thoothukudi", "Tiruchirappalli", "Tirunelveli",
  "Tirupathur", "Tiruppur", "Tiruvallur", "Tiruvannamalai", "Tiruvarur",
  "Vellore", "Viluppuram", "Virudhunagar"
];

export default function Home() {
  const [time, setTime] = useState<string>("");
  const [incidents, setIncidents] = useState<Record<string, Incident>>({});
  const [socket, setSocket] = useState<Socket | null>(null);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [dispatcherNotes, setDispatcherNotes] = useState<string>("");
  
  // District Filter State
  const [selectedDistrict, setSelectedDistrict] = useState<string>("ALL");
  const availableDistricts = ["ALL", ...TAMIL_NADU_DISTRICTS];

  // Auth State
  const [token, setToken] = useState<string | null>(null);
  const [username, setUsername] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [loginError, setLoginError] = useState<string>("");

  useEffect(() => {
    // Start clock
    setTime(new Date().toLocaleTimeString());
    const interval = setInterval(() => {
      setTime(new Date().toLocaleTimeString());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!token) return;

    // Connect to the Render Node.js backend using the JWT Auth Token
    const newSocket = io(SERVER_URL, {
      auth: { token }
    });
    setSocket(newSocket);

    newSocket.on("connect", () => {
      console.log("Connected to secure socket server!");
      // The dispatcher must actively join the incident channel
      newSocket.emit("join_incident", { incidentId: "GLOBAL_TEST_INCIDENT" });
    });

    newSocket.on("connect_error", (err) => {
      console.error("Connection Error:", err.message);
      if (err.message === "unauthorized") {
        setToken(null);
        setLoginError("Session expired. Please log in again.");
      }
    });

    // Listen for new or updated incident locations (Immediate zero-latency broadcast)
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

    // Listen for asynchronous district resolution
    newSocket.on("incident_district_resolved", (payload: { incidentId: string, district: string }) => {
      setIncidents((prev) => {
        if (!prev[payload.incidentId]) return prev;
        return {
          ...prev,
          [payload.incidentId]: { ...prev[payload.incidentId], district: payload.district },
        };
      });
    });

    // Listen for status changes (e.g. marked as answered by another dispatcher, or cancelled by user)
    newSocket.on("incident_status_changed", (payload: { incidentId: string, status: 'ACTIVE' | 'ANSWERED' | 'CANCELLED_BY_USER', notes: string }) => {
      setIncidents((prev) => {
        if (!prev[payload.incidentId]) return prev;
        return {
          ...prev,
          [payload.incidentId]: { ...prev[payload.incidentId], status: payload.status },
        };
      });
      if (payload.status === 'ANSWERED' || payload.status === 'CANCELLED_BY_USER') {
        setSelectedIncidentId(null);
      }
    });

    return () => {
      newSocket.disconnect();
    };
  }, [token]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    try {
      const res = await fetch(`${SERVER_URL}/api/dispatcher/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (res.ok && data.token) {
        setToken(data.token);
      } else {
        setLoginError(data.error || "Login failed");
      }
    } catch (err) {
      setLoginError("Server unreachable. Please wait for Render to spin up.");
    }
  };

  const handleAnswerIncident = async (incidentId: string) => {
    try {
      await fetch(`${SERVER_URL}/api/dispatch/incident/${incidentId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'ANSWERED', notes: dispatcherNotes })
      });
      setDispatcherNotes("");
    } catch (e) {
      console.error("Failed to answer incident", e);
    }
  };

  // Convert dictionary to array, filter by district, and sort newest first
  const incidentList = Object.values(incidents)
    .filter(i => selectedDistrict === "ALL" || i.district === selectedDistrict)
    .sort((a, b) => b.timestamp - a.timestamp);
    
  const selectedIncident = selectedIncidentId ? incidents[selectedIncidentId] : null;

  if (!token) {
    return (
      <main className={styles.main} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ background: '#1a1a2e', padding: '2rem', borderRadius: '12px', border: '1px solid #333', minWidth: '350px' }}>
          <div className={styles.logo} style={{ marginBottom: '2rem', justifyContent: 'center' }}>
            <div className={styles.pulseDot}></div>
            <h1 style={{ margin: 0 }}>Offline Guardian</h1>
          </div>
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {loginError && <div style={{ color: '#ff4d4f', fontSize: '0.9rem', textAlign: 'center' }}>{loginError}</div>}
            <input 
              type="text" 
              placeholder="Dispatcher Username" 
              value={username}
              onChange={e => setUsername(e.target.value)}
              style={{ padding: '0.8rem', borderRadius: '6px', border: 'none', background: '#0f0f1a', color: 'white' }}
            />
            <input 
              type="password" 
              placeholder="Password" 
              value={password}
              onChange={e => setPassword(e.target.value)}
              style={{ padding: '0.8rem', borderRadius: '6px', border: 'none', background: '#0f0f1a', color: 'white' }}
            />
            <button 
              type="submit" 
              style={{ padding: '0.8rem', borderRadius: '6px', border: 'none', background: '#ff4d4f', color: 'white', fontWeight: 'bold', cursor: 'pointer', marginTop: '0.5rem' }}
            >
              SECURE LOGIN
            </button>
            <div style={{ textAlign: 'center', fontSize: '0.8rem', color: '#666', marginTop: '1rem' }}>
              CM Pilot Demo: use admin / admin123
            </div>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className={styles.main}>
      <header className={styles.header}>
        <div className={styles.logo}>
          <div className={styles.pulseDot}></div>
          <h1>Offline Guardian // <span className={styles.subtitle}>Master Control</span></h1>
        </div>
        
        {/* District Filter Dropdown */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginLeft: 'auto', marginRight: '2rem' }}>
          <span style={{ color: '#888', fontSize: '0.9rem' }}>Jurisdiction:</span>
          <select 
            value={selectedDistrict}
            onChange={(e) => setSelectedDistrict(e.target.value)}
            style={{ padding: '0.5rem', background: '#111', color: 'white', border: '1px solid #333', borderRadius: '4px' }}
          >
            {availableDistricts.map(dist => (
              <option key={dist} value={dist}>{dist}</option>
            ))}
          </select>
        </div>

        <div className={styles.status}>
          <span className={styles.statusOnline}>SYSTEM SECURE</span>
          <span className={styles.time}>{time}</span>
          <button onClick={() => setToken(null)} style={{ marginLeft: '1rem', background: 'transparent', border: '1px solid #555', color: '#aaa', padding: '0.2rem 0.5rem', borderRadius: '4px', cursor: 'pointer'}}>Logout</button>
        </div>
      </header>
      
      <div className={styles.mapContainer}>
        <div className={styles.mapOverlay}>
          <h2>Active Area Monitoring</h2>
          <p>Listening for Tier 1 Online & Tier 3 Mesh relay packets...</p>
        </div>
        <MapComponent incidents={incidents} selectedIncidentId={selectedIncidentId} />
      </div>

      {/* Instagram-style Incident Queue */}
      <div className={styles.sidebar}>
        <h3>Incoming Incidents</h3>
        
        {incidentList.length === 0 ? (
          <div className={styles.emptyState}>
            Waiting for SOS trigger in {selectedDistrict === "ALL" ? "all districts" : selectedDistrict}...
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
                    {incident.district && (
                      <span style={{ color: '#aaa', marginLeft: '0.5rem', fontSize: '0.75rem' }}> • {incident.district}</span>
                    )}
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
              <span>District:</span> {selectedIncident.district || "Resolving..."}
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
