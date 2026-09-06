"use client";

import { useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from "react-leaflet";
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
  selectedIncidentId: string | null;
  historicalIncidents?: Record<string, Incident>;
}

// Controller component to hook into the Leaflet map instance and trigger flyTo animations
function MapZoomController({ selectedIncidentId, incidents }: MapProps) {
  const map = useMap();

  useEffect(() => {
    if (selectedIncidentId && incidents[selectedIncidentId]) {
      const incident = incidents[selectedIncidentId];
      // Smoothly animate the map to the selected incident
      map.flyTo([incident.lat, incident.lng], 16, {
        animate: true,
        duration: 1.5 // 1.5 seconds animation
      });
    }
  }, [selectedIncidentId, incidents, map]);

  return null; // This component doesn't render anything visually
}

export default function MapComponent({ incidents, selectedIncidentId, historicalIncidents = {} }: MapProps) {
  // Center of Tamil Nadu
  const centerPosition: [number, number] = [11.1271, 78.6569]; 
  
  // Strict bounding box for Tamil Nadu to prevent panning away
  const tamilNaduBounds: L.LatLngBoundsLiteral = [
    [8.077, 76.230], // Southwest corner
    [13.493, 80.345] // Northeast corner
  ];

  const activeIncidentList = Object.values(incidents);
  const activeCenter = activeIncidentList.length > 0 
    ? [activeIncidentList[0].lat, activeIncidentList[0].lng] 
    : centerPosition;

  return (
    <div style={{ height: "100%", width: "100%", position: "relative" }}>
      <MapContainer 
        center={activeCenter as [number, number]} 
        zoom={activeIncidentList.length > 0 ? 15 : 7} 
        minZoom={7}
        maxBounds={tamilNaduBounds}
        maxBoundsViscosity={1.0}
        style={{ height: "100%", width: "100%" }}
        zoomControl={true}
      >
        <MapZoomController selectedIncidentId={selectedIncidentId} incidents={incidents} />

        {/* Standard OSM Tiles inverted for Dark Mode via CSS (No API Key Required!) */}
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          className="dark-map-tiles"
        />

        {/* PREDICTIVE AI HEATMAP (Historical Incidents) */}
        {Object.values(historicalIncidents).map((incident) => (
          <Circle
            key={`history-${incident.incidentId}`}
            center={[incident.lat, incident.lng]}
            radius={200} // Much larger radius for heatmap diffusion
            pathOptions={{
              color: 'transparent',
              fillColor: '#ff0000', // Intense red
              fillOpacity: 0.15 // Overlapping circles will compound to bright red
            }}
          />
        ))}

        {activeIncidentList.map((incident) => {
          const isFlagged = incident.trustStatus === "NEEDS_REVIEW";
          const isAnswered = incident.status === "ANSWERED";
          const isCancelled = incident.status === "CANCELLED_BY_USER";
          
          let circleColor = "#ff4444"; // Active (Red)
          if (isFlagged) circleColor = "#f5a623"; // Flagged (Orange)
          if (isAnswered) circleColor = "#00ff00"; // Answered (Green)
          if (isCancelled) circleColor = "#555555"; // Cancelled/Offline (Grey)

          // Hide dismissed/answered incidents from the map UNLESS they are actively clicked/selected
          const isInactive = isAnswered || isCancelled;
          if (isInactive && incident.incidentId !== selectedIncidentId) {
            return null;
          }

          return (
            <div key={incident.incidentId}>
              <Circle 
                center={[incident.lat, incident.lng]} 
                radius={30}
                pathOptions={{
                  color: circleColor,
                  fillColor: circleColor,
                  fillOpacity: (isAnswered || isCancelled) ? 0.2 : 0.4 // Dim opacity if inactive
                }}
              />
              <Marker position={[incident.lat, incident.lng]}>
                <Popup>
                  <div className="popup-content">
                    <h3 style={{ color: circleColor }}>SOS Alert</h3>
                    <p><strong>Device UUID:</strong> {incident.deviceUuid.substring(0, 8)}...</p>
                    <p><strong>District:</strong> {incident.district || "Resolving..."}</p>
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
