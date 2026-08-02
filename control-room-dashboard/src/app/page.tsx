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
  senderProfile?: {
    phone_number: string;
    name: string;
    age?: number | null;
    current_address?: string | null;
    workplace_details?: string | null;
    photo_base64?: string | null;
  } | null;
}

const SERVER_URL = "https://tn-safety-app-qq1f.onrender.com";

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
  
  // Dashboard Tabs
  const [activeTab, setActiveTab] = useState<'INCIDENTS' | 'OFFICERS'>('INCIDENTS');
  const [officers, setOfficers] = useState<any[]>([]);

  useEffect(() => {
    // Start clock
    setTime(new Date().toLocaleTimeString());
    const interval = setInterval(() => {
      setTime(new Date().toLocaleTimeString());
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  const fetchOfficers = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${SERVER_URL}/api/admin/officers`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setOfficers(data);
      }
    } catch (e) {
      console.error("Failed to fetch officers", e);
    }
  };

  useEffect(() => {
    if (activeTab === 'OFFICERS' && token) {
      fetchOfficers();
    }
  }, [activeTab, token]);

  const verifyOfficer = async (officerId: number) => {
    try {
      const res = await fetch(`${SERVER_URL}/api/admin/officers/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ officerId })
      });
      if (res.ok) {
        alert("Officer Verified Successfully.");
        fetchOfficers();
      } else {
        alert("Verification Failed. You may not have Admin privileges.");
      }
    } catch (e) {
      alert("Verification Request Failed.");
    }
  };

  const revokeOfficer = async (officerId: number) => {
    const reason = prompt("Enter revocation reason (for audit log):");
    if (reason === null) return; // Cancelled

    try {
      const res = await fetch(`${SERVER_URL}/api/admin/officers/revoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ officerId, reason })
      });
      if (res.ok) {
        alert("Officer Revoked Successfully.");
        fetchOfficers();
      } else {
        alert("Revocation Failed.");
      }
    } catch (e) {
      alert("Revocation Request Failed.");
    }
  };

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
      // Only auto-deselect if it was fully archived/answered by a dispatcher
      if (payload.status === 'ANSWERED') {
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
    <div className={styles.container}>
      {/* Top Navbar */}
      <nav className={styles.navbar}>
        <div className={styles.navLeft}>
          <div className={styles.pulseIndicator}></div>
          <h1 className={styles.navTitle}>Offline Guardian <span className={styles.navSubtitle}>// Master Control</span></h1>
          
          {/* Tabs */}
          <div className={styles.tabContainer}>
            <button 
              className={activeTab === 'INCIDENTS' ? styles.tabButtonActive : styles.tabButton}
              onClick={() => setActiveTab('INCIDENTS')}
            >
              Incidents
            </button>
            <button 
              className={activeTab === 'OFFICERS' ? styles.tabButtonActive : styles.tabButton}
              onClick={() => setActiveTab('OFFICERS')}
            >
              Verify Officers
            </button>
          </div>
        </div>

        <div className={styles.navRight}>
          {activeTab === 'INCIDENTS' && (
            <div className={styles.filterGroup}>
              <label>Jurisdiction:</label>
              <select 
                value={selectedDistrict} 
                onChange={(e) => setSelectedDistrict(e.target.value)}
                className={styles.districtSelect}
              >
                {availableDistricts.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          )}
          <div className={styles.navStatus}>SYSTEM SECURE</div>
          <div className={styles.navTime}>{time}</div>
          <button className={styles.logoutButton} onClick={() => setToken(null)}>Logout</button>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className={styles.mainContent}>
        {activeTab === 'INCIDENTS' ? (
          <>
            {/* Left: Interactive Map */}
            <div className={styles.mapContainer}>
              <div className={styles.mapOverlay}>
                <h2>ACTIVE AREA MONITORING</h2>
                <p>Listening for Tier 1 Online & Tier 3 Mesh relay packets...</p>
              </div>
              <MapComponent incidents={incidents} selectedIncidentId={selectedIncidentId} />
            </div>

            {/* Right: Sidebar */}
            <div className={styles.sidebar}>
              <div className={styles.sidebarHeader}>
                <h3>INCOMING INCIDENTS</h3>
              </div>
              
              <div className={styles.incidentList}>
                {incidentList.length === 0 && (
                  <div className={styles.emptyState}>No active incidents in this jurisdiction.</div>
                )}
                
                {incidentList.map(incident => (
                  <div 
                    key={incident.incidentId}
                    className={`${styles.incidentCard} ${selectedIncidentId === incident.incidentId ? styles.selectedCard : ''}`}
                    onClick={() => setSelectedIncidentId(incident.incidentId)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                      {/* Avatar Side */}
                      {incident.senderProfile && incident.senderProfile.photo_base64 ? (
                        <div style={{ position: 'relative' }}>
                          <img src={incident.senderProfile.photo_base64} style={{ width: '50px', height: '50px', borderRadius: '25px', objectFit: 'cover', border: incident.status === 'ACTIVE' ? '2px solid #ff4d4f' : '2px solid #555' }} />
                          {incident.status === 'ACTIVE' && (
                            <div style={{ position: 'absolute', bottom: 0, right: 0, width: 12, height: 12, backgroundColor: '#ff4d4f', borderRadius: 6, border: '2px solid #1a1a1a' }} />
                          )}
                        </div>
                      ) : (
                        <div className={`${styles.urgencyBadge} ${incident.status !== 'ACTIVE' ? styles.urgencyBadgeAnswered : ''}`} style={{ flexShrink: 0 }}>
                          {incident.trustStatus === 'NEEDS_REVIEW' ? 'FLAG' : 'SOS'}
                        </div>
                      )}
                      
                      {/* Details Side */}
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <strong style={{ fontSize: '14px', color: '#fff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {incident.senderProfile ? incident.senderProfile.name : `ID: ${incident.deviceUuid.substring(0,8)}`}
                          </strong>
                          <span className={styles.queueTime}>{new Date(incident.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                        </div>
                        <div className={styles.incidentSub}>
                          <span style={{
                            color: incident.status === 'ACTIVE' ? '#ff4d4f' : 
                                   incident.status === 'CANCELLED_BY_USER' ? '#555555' : '#00ff00',
                            fontWeight: 'bold',
                            fontSize: '0.8rem'
                          }}>
                            {incident.status === 'CANCELLED_BY_USER' ? 'OFFLINE (DISARMED)' : incident.status}
                          </span>
                          {incident.district && (
                            <span style={{ color: '#aaa', marginLeft: '0.5rem', fontSize: '0.75rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}> • {incident.district}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              
              {/* Action Panel for answering the selected incident */}
              {selectedIncident && (selectedIncident.status === 'ACTIVE' || selectedIncident.status === 'CANCELLED_BY_USER') && (
                <div className={styles.actionPanel}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <h4 style={{ margin: 0 }}>{selectedIncident.status === 'CANCELLED_BY_USER' ? "Log False Alarm" : "Take Information"}</h4>
                    <button 
                      onClick={() => setSelectedIncidentId(null)} 
                      style={{ background: 'transparent', border: 'none', color: '#888', fontSize: '20px', cursor: 'pointer', padding: '0 5px' }}
                    >×</button>
                  </div>
                  <div className={styles.infoRow}>
                    <span>Device:</span> {selectedIncident.deviceUuid.substring(0,8)}
                  </div>
                  <div className={styles.infoRow}>
                    <span>District:</span> {selectedIncident.district || "Resolving..."}
                  </div>
                  <div className={styles.infoRow}>
                    <span>Battery:</span> {selectedIncident.battery}%
                  </div>
                  
                  {selectedIncident.senderProfile && (
                    <div style={{ padding: '12px', background: '#222', borderRadius: '8px', marginBottom: '15px', borderLeft: '4px solid #ff4d4f' }}>
                      <h5 style={{ margin: '0 0 10px 0', color: '#ff4d4f', fontSize: '11px', letterSpacing: '1px' }}>CIVILIAN IDENTITY</h5>
                      <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                        {selectedIncident.senderProfile.photo_base64 && (
                          <img src={selectedIncident.senderProfile.photo_base64} style={{ width: '60px', height: '60px', borderRadius: '30px', border: '2px solid #555' }} />
                        )}
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '15px', color: '#fff', fontWeight: 'bold' }}>
                            {selectedIncident.senderProfile.name} {selectedIncident.senderProfile.age ? `(${selectedIncident.senderProfile.age})` : ''}
                          </div>
                          <div style={{ fontSize: '12px', color: '#00ff00', fontWeight: 'bold', marginTop: '2px' }}>
                            {selectedIncident.senderProfile.phone_number}
                          </div>
                        </div>
                      </div>
                      <div style={{ fontSize: '11px', color: '#ccc', marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <div><strong style={{ color: '#888' }}>Home:</strong> {selectedIncident.senderProfile.current_address || 'Unknown'}</div>
                        <div><strong style={{ color: '#888' }}>Work/School:</strong> {selectedIncident.senderProfile.workplace_details || 'Unknown'}</div>
                      </div>
                    </div>
                  )}

                  <textarea 
                    className={styles.notesInput}
                    placeholder="Dispatcher notes (e.g., false alarm logged)..."
                    value={dispatcherNotes}
                    onChange={(e) => setDispatcherNotes(e.target.value)}
                  />
                  <button 
                    className={styles.answerButton}
                    style={{ backgroundColor: selectedIncident.status === 'CANCELLED_BY_USER' ? '#555' : '#ff4d4f' }}
                    onClick={() => handleAnswerIncident(selectedIncident.incidentId)}
                  >
                    {selectedIncident.status === 'CANCELLED_BY_USER' ? "Archive Incident" : "Mark as Answered"}
                  </button>
                </div>
              )}
            </div>
          </>
        ) : (
          /* OFFICER VERIFICATION TAB */
          <div className={styles.officerContainer}>
            <div className={styles.officerHeader}>
              <h2>Patrol Officer Verification</h2>
              <p>Cross-check the exact phone-to-badge pairing against the state registry before approving access to the live dispatch stream.</p>
            </div>
            <div className={styles.officerList}>
              {officers.map(off => (
                <div key={off.id} className={styles.officerCard}>
                  <div className={styles.officerInfo}>
                    <strong>Badge: {off.badge_number}</strong>
                    <span>Phone: {off.phone_number}</span>
                    <span>
                      Status: <b style={{ color: off.status === 'VERIFIED' ? '#00ff00' : off.status === 'REVOKED' ? '#ff4d4f' : '#f5a623'}}>{off.status}</b>
                    </span>
                  </div>
                  {off.status === 'PENDING' && (
                    <button className={styles.verifyBtn} onClick={() => verifyOfficer(off.id)}>
                      Approve & Verify
                    </button>
                  )}
                  {off.status === 'VERIFIED' && (
                    <button className={styles.verifyBtn} style={{ backgroundColor: '#555' }} onClick={() => revokeOfficer(off.id)}>
                      Revoke
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
