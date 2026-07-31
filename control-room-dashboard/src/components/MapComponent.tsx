"use client";

import { MapContainer, TileLayer, Marker, Popup, Circle } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { Incident } from "../app/page";

// Fix Leaflet's default icon path issues in Next.js
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png",
  iconUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png",
});

interface MapProps {
  incidents: Record<string, Incident>;
}

export default function MapComponent({ incidents }: MapProps) {
  // Default to a central location (e.g., India) if no active incidents
  const centerPosition: [number, number] = [20.5937, 78.9629];
  const activeIncidentList = Object.values(incidents);
  const activeCenter = activeIncidentList.length > 0 
    ? [activeIncidentList[0].lat, activeIncidentList[0].lng] 
    : centerPosition;

  return (
    <div style={{ height: "100%", width: "100%", position: "relative" }}>
      <MapContainer 
        center={activeCenter as [number, number]} 
        zoom={activeIncidentList.length > 0 ? 15 : 5} 
        style={{ height: "100%", width: "100%" }}
        zoomControl={false}
      >
        {/* Sleek Dark Mode Map Tiles via CartoDB */}
        <TileLayer
          url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        />

        {activeIncidentList.map((incident) => {
          const isFlagged = incident.trustStatus === "NEEDS_REVIEW";
          const isAnswered = incident.status === "ANSWERED";
          
          let circleColor = "#ff4444"; // Active (Red)
          if (isFlagged) circleColor = "#f5a623"; // Flagged (Orange)
          if (isAnswered) circleColor = "#00ff00"; // Answered (Green)

          return (
            <div key={incident.incidentId}>
              <Circle 
                center={[incident.lat, incident.lng]} 
                radius={30}
                pathOptions={{
                  color: circleColor,
                  fillColor: circleColor,
                  fillOpacity: isAnswered ? 0.2 : 0.4 // Dim opacity if answered
                }}
              />
              <Marker position={[incident.lat, incident.lng]}>
                <Popup>
                  <div className="popup-content">
                    <h3 style={{ color: circleColor }}>SOS Alert</h3>
                    <p><strong>Device UUID:</strong> {incident.deviceUuid.substring(0, 8)}...</p>
                    <p><strong>Battery:</strong> {incident.battery}%</p>
                    <p>
                      <strong>Status:</strong> 
                      <span className={isFlagged && !isAnswered ? 'status-flagged' : (isAnswered ? 'status-answered' : 'status-active')}>
                        {isAnswered ? "ANSWERED" : (isFlagged ? "NEEDS REVIEW" : "ACTIVE")}
                      </span>
                    </p>
                    <p className="timestamp">{new Date(incident.timestamp).toLocaleTimeString()}</p>
                  </div>
                </Popup>
              </Marker>
            </div>
          );
        })}
      </MapContainer>
    </div>
  );
}
