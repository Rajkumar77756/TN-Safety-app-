"use client";
import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import { io, Socket } from "socket.io-client";
import styles from "./page.module.css";
import Link from "next/link";

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
  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
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
  
  // History Mode State
  const [historyDate, setHistoryDate] = useState<string>("LIVE");
  const [historicalIncidents, setHistoricalIncidents] = useState<Record<string, Incident>>({});
  const [predictiveHeatmapData, setPredictiveHeatmapData] = useState<Record<string, Incident>>({});
  const [peakTime, setPeakTime] = useState<string | null>(null);
  
  // Audio Evidence State
  const [audioFiles, setAudioFiles] = useState<string[]>([]);
  const [playingAudio, setPlayingAudio] = useState<string | null>(null);

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

    if (historyDate === "LIVE") {
      setPeakTime(null);
      // Fetch today's and yesterday's data to build a localized predictive AI heatmap
      const fetchPredictiveData = async () => {
        try {
          const res = await fetch(`${SERVER_URL}/api/admin/incidents/history`, {
            headers: { 'Authorization': `Bearer ${token}` }
          });
          if (res.ok) {
            const data = await res.json();
            setPredictiveHeatmapData(data.incidents || {});
          }
        } catch (e) {
          console.error("Failed to fetch predictive heatmap", e);
        }
      };
      fetchPredictiveData();
      return;
    }

    const fetchHistory = async () => {
      try {
        const res = await fetch(`${SERVER_URL}/api/admin/incidents/history?date=${historyDate}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const data = await res.json();
          setHistoricalIncidents(data.incidents);
          setPredictiveHeatmapData({}); // Hide heatmap in history mode
          
          // Calculate Peak Time
          const incidentsList = Object.values(data.incidents) as Incident[];
          if (incidentsList.length > 0) {
            const hourCounts: Record<number, number> = {};
            incidentsList.forEach(inc => {
              const hour = new Date(inc.timestamp).getHours();
              hourCounts[hour] = (hourCounts[hour] || 0) + 1;
            });
            let maxHour = 0;
            let maxCount = 0;
            Object.entries(hourCounts).forEach(([hour, count]) => {
              if (count > maxCount) {
                maxCount = count;
                maxHour = parseInt(hour);
              }
            });
            const ampm = maxHour >= 12 ? 'PM' : 'AM';
            const h = maxHour % 12 || 12;
            setPeakTime(`${h}:00 ${ampm} - ${h}:59 ${ampm} (${maxCount} incidents)`);
          } else {
            setPeakTime("No incidents recorded on this date.");
          }
        }
      } catch (e) {
        console.error("Failed to fetch history", e);
      }
    };
    fetchHistory();
  }, [historyDate, token]);

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
    const handleIncomingIncident = (payload: any) => {
      if (!payload || !payload.incidentId) return;
      setIncidents((prev) => {
        // If it's a completely new incident, default status to ACTIVE
        const existingStatus = prev[payload.incidentId]?.status || 'ACTIVE';
        return {
          ...prev,
          [payload.incidentId]: { ...payload, status: existingStatus },
        };
      });
    };

    newSocket.on("incident_location_updated", handleIncomingIncident);
    newSocket.on("new_incident", handleIncomingIncident);

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
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({ status: 'ANSWERED', notes: dispatcherNotes })
      });
      setDispatcherNotes("");
    } catch (e) {
      console.error("Failed to answer incident", e);
    }
  };

  const fetchAudioEvidence = async (incidentId: string) => {
    if (!token) return;
    try {
      const res = await fetch(`${SERVER_URL}/api/admin/incidents/${incidentId}/audio`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setAudioFiles(data.audioFiles || []);
        if (data.audioFiles?.length > 0) {
          setPlayingAudio(`${SERVER_URL}${data.audioFiles[0]}`); // Play first audio chunk
        } else {
          alert("No audio evidence found for this incident.");
        }
      }
    } catch(e) {
      console.error(e);
    }
  };

  // Convert dictionary to array, filter by district, and sort newest first
  const activeDictionary = historyDate === "LIVE" ? incidents : historicalIncidents;
  const incidentList = Object.values(activeDictionary)
    .filter(i => selectedDistrict === "ALL" || i.district === selectedDistrict)
    .sort((a, b) => b.timestamp - a.timestamp);
    
  const selectedIncident = selectedIncidentId ? activeDictionary[selectedIncidentId] : null;

  if (!token) {
    return (
      <main className={styles.main} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: theme === 'dark' ? '#0a0a0a' : '#f5f5f5', color: theme === 'dark' ? '#ededed' : '#111' }}>
        <div style={{ position: 'absolute', top: '20px', right: '20px' }}>
           <button 
             onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
             style={{ padding: '8px 16px', background: theme === 'dark' ? '#333' : '#e0e0e0', color: theme === 'dark' ? '#fff' : '#000', borderRadius: '4px', border: 'none', cursor: 'pointer' }}
           >
             Toggle {theme === 'dark' ? 'Light' : 'Dark'} Mode
           </button>
        </div>
        <div style={{ background: theme === 'dark' ? '#1a1a2e' : '#fff', padding: '2rem', borderRadius: '12px', border: `1px solid ${theme === 'dark' ? '#333' : '#ddd'}`, minWidth: '350px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
          <div className={styles.logo} style={{ marginBottom: '2rem', justifyContent: 'center' }}>
            <div className={styles.pulseDot}></div>
            <h1 style={{ margin: 0, color: theme === 'dark' ? '#fff' : '#000' }}>Offline Guardian</h1>
          </div>
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {loginError && <div style={{ color: '#ff4d4f', fontSize: '0.9rem', textAlign: 'center' }}>{loginError}</div>}
            <input 
              type="text" 
              placeholder="Dispatcher Username" 
              value={username}
              onChange={e => setUsername(e.target.value)}
              style={{ padding: '0.8rem', borderRadius: '6px', border: `1px solid ${theme === 'dark' ? 'transparent' : '#ddd'}`, background: theme === 'dark' ? '#0f0f1a' : '#f9f9f9', color: theme === 'dark' ? 'white' : 'black' }}
            />
            <input 
              type="password" 
              placeholder="Password" 
              value={password}
              onChange={e => setPassword(e.target.value)}
              style={{ padding: '0.8rem', borderRadius: '6px', border: `1px solid ${theme === 'dark' ? 'transparent' : '#ddd'}`, background: theme === 'dark' ? '#0f0f1a' : '#f9f9f9', color: theme === 'dark' ? 'white' : 'black' }}
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
            <div style={{ textAlign: 'center', marginTop: '1rem' }}>
              <Link href="/privacy-policy" style={{ color: '#ff4d4f', fontSize: '0.9rem', textDecoration: 'underline' }}>Privacy Policy</Link>
            </div>
          </form>
        </div>
      </main>
    );
  }

  return (
    <div className={styles.container} style={{ backgroundColor: theme === 'dark' ? '#0a0a0a' : '#f5f5f5', color: theme === 'dark' ? '#ededed' : '#111' }}>
      {/* Top Navbar */}
      <nav className={styles.navbar} style={{ backgroundColor: theme === 'dark' ? '#111' : '#fff', borderBottomColor: theme === 'dark' ? '#333' : '#ddd' }}>
        <div className={styles.navLeft}>
          <div className={styles.pulseIndicator}></div>
          <h1 className={styles.navTitle} style={{ color: theme === 'dark' ? '#fff' : '#000' }}>Offline Guardian <span className={styles.navSubtitle}>// Master Control</span></h1>
          
          {/* Tabs */}
          <div className={styles.tabContainer}>
            <button 
              className={activeTab === 'INCIDENTS' ? styles.tabButtonActive : styles.tabButton}
              onClick={() => setActiveTab('INCIDENTS')}
              style={{ color: activeTab === 'INCIDENTS' ? '#ff4d4f' : (theme === 'dark' ? '#888' : '#555') }}
            >
              Incidents
            </button>
            <button 
              className={activeTab === 'OFFICERS' ? styles.tabButtonActive : styles.tabButton}
              onClick={() => setActiveTab('OFFICERS')}
              style={{ color: activeTab === 'OFFICERS' ? '#ff4d4f' : (theme === 'dark' ? '#888' : '#555') }}
            >
              Verify Officers
            </button>
          </div>
        </div>

        <div className={styles.navRight}>
          {activeTab === 'INCIDENTS' && (
            <div className={styles.filterGroup}>
              <label style={{ color: theme === 'dark' ? '#fff' : '#000' }}>Jurisdiction:</label>
              <select 
                value={selectedDistrict} 
                onChange={(e) => setSelectedDistrict(e.target.value)}
                className={styles.districtSelect}
                style={{ background: theme === 'dark' ? '#222' : '#f0f0f0', color: theme === 'dark' ? '#fff' : '#000', borderColor: theme === 'dark' ? '#444' : '#ccc' }}
              >
                {availableDistricts.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          )}
          <div className={styles.navStatus}>SYSTEM SECURE</div>
          <div className={styles.navTime}>{time}</div>
          <button 
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            style={{ padding: '5px 10px', background: theme === 'dark' ? '#333' : '#e0e0e0', color: theme === 'dark' ? '#fff' : '#000', borderRadius: '4px', border: 'none', cursor: 'pointer', marginRight: '10px' }}
          >
            {theme === 'dark' ? 'Light' : 'Dark'} Mode
          </button>
          <Link href="/privacy-policy" style={{ color: '#ff4d4f', fontSize: '0.9rem', marginRight: '1rem', textDecoration: 'underline' }}>Privacy</Link>
          <button className={styles.logoutButton} style={{ color: theme === 'dark' ? '#fff' : '#000', borderColor: theme === 'dark' ? '#444' : '#ccc' }} onClick={() => setToken(null)}>Logout</button>
        </div>
      </nav>

      {/* Main Content Area */}
      <main className={styles.mainContent}>
        {activeTab === 'INCIDENTS' ? (
          <>
            {/* Left: Interactive Map */}
            <div className={styles.mapContainer}>
              <div className={styles.mapOverlay} style={{ background: theme === 'dark' ? 'rgba(20, 20, 30, 0.6)' : 'rgba(255, 255, 255, 0.8)', borderColor: theme === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)' }}>
                <h2 style={{ color: theme === 'dark' ? '#fff' : '#000' }}>ACTIVE AREA MONITORING</h2>
                <p style={{ color: theme === 'dark' ? '#aaa' : '#555' }}>Listening for Tier 1 Online & Tier 3 Mesh relay packets...</p>
                {historyDate === "LIVE" && <p style={{ color: '#ff4d4f', fontSize: '0.8rem', marginTop: '5px' }}>🔴 PREDICTIVE AI HEATMAP ACTIVE</p>}
              </div>
              <MapComponent incidents={activeDictionary} selectedIncidentId={selectedIncidentId} historicalIncidents={predictiveHeatmapData} />
            </div>

            {/* Right: Sidebar */}
            <div className={styles.sidebar} style={{ background: theme === 'dark' ? 'rgba(17, 17, 17, 0.9)' : 'rgba(255, 255, 255, 0.95)', borderColor: theme === 'dark' ? '#333' : '#ddd' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', padding: '1rem', color: theme === 'dark' ? '#fff' : '#000', borderBottom: `1px solid ${theme === 'dark' ? '#333' : '#ddd'}` }}>
                <h3 style={{ margin: 0, padding: 0, border: 'none' }}>INCOMING INCIDENTS</h3>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <label htmlFor="historyDate" style={{ fontSize: '0.8rem', color: theme === 'dark' ? '#888' : '#555' }}>History:</label>
                  <input 
                    type="date" 
                    id="historyDate"
                    style={{ padding: '5px', borderRadius: '4px', background: theme === 'dark' ? '#262626' : '#f0f0f0', color: theme === 'dark' ? '#fff' : '#000', border: `1px solid ${theme === 'dark' ? '#444' : '#ccc'}` }}
                    onChange={(e) => setHistoryDate(e.target.value || "LIVE")}
                  />
                  {historyDate !== "LIVE" && (
                    <button 
                      onClick={() => { setHistoryDate("LIVE"); (document.getElementById("historyDate") as HTMLInputElement).value = ""; }}
                      style={{ background: '#ff4d4f', color: '#fff', border: 'none', borderRadius: '4px', padding: '5px 10px', cursor: 'pointer', fontSize: '0.8rem' }}
                    >
                      RETURN TO LIVE
                    </button>
                  )}
                </div>
              </div>

              {historyDate !== "LIVE" && peakTime && (
                <div style={{ background: theme === 'dark' ? '#332b00' : '#fff8dc', color: theme === 'dark' ? '#ffd700' : '#b8860b', padding: '10px', borderRadius: '8px', margin: '0 15px 15px 15px', fontSize: '0.9rem', border: `1px solid ${theme === 'dark' ? '#665500' : '#eedd82'}` }}>
                  <strong>Peak Time Analysis:</strong> {peakTime}
                </div>
              )}

              <div className={styles.incidentList} style={{ flexGrow: 1, overflowY: 'auto' }}>
                {incidentList.length === 0 && (
                  <div className={styles.emptyState} style={{ color: theme === 'dark' ? '#666' : '#999' }}>No active incidents in this jurisdiction.</div>
                )}
                
                {incidentList.map(incident => (
                  <div 
                    key={incident.incidentId}
                    className={`${styles.incidentCard} ${selectedIncidentId === incident.incidentId ? styles.selectedCard : ''}`}
                    onClick={() => setSelectedIncidentId(incident.incidentId)}
                    style={{ 
                       padding: '12px 15px', 
                       borderBottom: `1px solid ${theme === 'dark' ? '#222' : '#eee'}`,
                       cursor: 'pointer',
                       background: selectedIncidentId === incident.incidentId 
                          ? (theme === 'dark' ? 'rgba(255, 68, 68, 0.1)' : 'rgba(255, 68, 68, 0.05)') 
                          : 'transparent'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                      {/* Avatar Side */}
                      {incident.senderProfile && incident.senderProfile.photo_base64 ? (
                        <div style={{ position: 'relative' }}>
                          <img src={incident.senderProfile.photo_base64} style={{ width: '50px', height: '50px', borderRadius: '25px', objectFit: 'cover', border: incident.status === 'ACTIVE' ? '2px solid #ff4d4f' : `2px solid ${theme === 'dark' ? '#555' : '#ccc'}` }} />
                          {incident.status === 'ACTIVE' && (
                            <div style={{ position: 'absolute', bottom: 0, right: 0, width: 12, height: 12, backgroundColor: '#ff4d4f', borderRadius: 6, border: `2px solid ${theme === 'dark' ? '#1a1a1a' : '#fff'}` }} />
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
                          <strong style={{ fontSize: '14px', color: theme === 'dark' ? '#fff' : '#000', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
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
                <div className={styles.actionPanel} style={{ background: theme === 'dark' ? '#1a1a1a' : '#fafafa', borderTopColor: theme === 'dark' ? '#333' : '#ddd' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <h4 style={{ margin: 0, color: theme === 'dark' ? '#fff' : '#000' }}>{selectedIncident.status === 'CANCELLED_BY_USER' ? "Log False Alarm" : "Take Information"}</h4>
                    <button 
                      onClick={() => setSelectedIncidentId(null)} 
                      style={{ background: 'transparent', border: 'none', color: '#888', fontSize: '20px', cursor: 'pointer', padding: '0 5px' }}
                    >×</button>
                  </div>
                  <div className={styles.infoRow} style={{ color: theme === 'dark' ? '#ddd' : '#333' }}>
                    <span>Device:</span> {selectedIncident.deviceUuid.substring(0,8)}
                  </div>
                  <div className={styles.infoRow} style={{ color: theme === 'dark' ? '#ddd' : '#333' }}>
                    <span>District:</span> {selectedIncident.district || "Resolving..."}
                  </div>
                  <div className={styles.infoRow} style={{ color: theme === 'dark' ? '#ddd' : '#333' }}>
                    <span>Battery:</span> {selectedIncident.battery}%
                  </div>
                  
                  {selectedIncident.senderProfile && (
                    <div style={{ padding: '12px', background: theme === 'dark' ? '#222' : '#fff', borderRadius: '8px', marginBottom: '15px', borderLeft: '4px solid #ff4d4f', boxShadow: theme === 'light' ? '0 2px 5px rgba(0,0,0,0.05)' : 'none' }}>
                      <h5 style={{ margin: '0 0 10px 0', color: '#ff4d4f', fontSize: '11px', letterSpacing: '1px' }}>CIVILIAN IDENTITY</h5>
                      <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                        {selectedIncident.senderProfile.photo_base64 && (
                          <img src={selectedIncident.senderProfile.photo_base64} style={{ width: '60px', height: '60px', borderRadius: '30px', border: `2px solid ${theme === 'dark' ? '#555' : '#eee'}` }} />
                        )}
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: '15px', color: theme === 'dark' ? '#fff' : '#000', fontWeight: 'bold' }}>
                            {selectedIncident.senderProfile.name} {selectedIncident.senderProfile.age ? `(${selectedIncident.senderProfile.age})` : ''}
                          </div>
                          <div style={{ fontSize: '12px', color: '#00cc00', fontWeight: 'bold', marginTop: '2px' }}>
                            {selectedIncident.senderProfile.phone_number}
                          </div>
                        </div>
                      </div>
                      <div style={{ fontSize: '11px', color: theme === 'dark' ? '#ccc' : '#666', marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
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
                    style={{ background: theme === 'dark' ? '#111' : '#fff', color: theme === 'dark' ? '#fff' : '#000', borderColor: theme === 'dark' ? '#333' : '#ccc' }}
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
          <div className={styles.officerContainer} style={{ background: theme === 'dark' ? '#111' : '#f9f9f9', color: theme === 'dark' ? 'white' : 'black' }}>
            <div className={styles.officerHeader}>
              <h2 style={{ color: '#ff4d4f' }}>Patrol Officer Verification</h2>
              <p style={{ color: theme === 'dark' ? '#888' : '#555' }}>Cross-check the exact phone-to-badge pairing against the state registry before approving access to the live dispatch stream.</p>
            </div>
            <div className={styles.officerList}>
              {officers.map(off => (
                <div key={off.id} className={styles.officerCard} style={{ background: theme === 'dark' ? '#1a1a1a' : '#fff', borderColor: theme === 'dark' ? '#333' : '#ddd' }}>
                  <div className={styles.officerInfo}>
                    <strong style={{ color: theme === 'dark' ? '#fff' : '#000' }}>Badge: {off.badge_number}</strong>
                    <span style={{ color: theme === 'dark' ? '#aaa' : '#666' }}>Phone: {off.phone_number}</span>
                    <span style={{ color: theme === 'dark' ? '#aaa' : '#666' }}>
                      Status: <b style={{ color: off.status === 'VERIFIED' ? '#00ff00' : off.status === 'REVOKED' ? '#ff4d4f' : '#f5a623'}}>{off.status}</b>
                    </span>
                  </div>
                  {off.status === 'PENDING' && (
                    <button className={styles.verifyBtn} onClick={() => verifyOfficer(off.id)}>
                      Approve & Verify
                    </button>
                  )}
                  {off.status === 'VERIFIED' && (
                    <button className={styles.verifyBtn} style={{ backgroundColor: '#555', color: '#fff' }} onClick={() => revokeOfficer(off.id)}>
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
