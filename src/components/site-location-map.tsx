"use client";

import { useEffect, useRef } from "react";
import * as L from "leaflet";

type SiteLocationMapProps = {
  siteId: string;
  latitude: number;
  longitude: number;
  online: boolean;
};

export function SiteLocationMap({ siteId, latitude, longitude, online }: SiteLocationMapProps) {
  const mapElement = useRef<HTMLDivElement>(null);
  const coordinates = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`;

  useEffect(() => {
    if (!online || !mapElement.current) return;

    const map = L.map(mapElement.current, {
      center: [latitude, longitude],
      zoom: 15,
      zoomControl: false,
      scrollWheelZoom: false,
    });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap contributors</a>',
    }).addTo(map);
    L.control.zoom({ position: "bottomright" }).addTo(map);
    const marker = L.marker([latitude, longitude], {
      icon: L.divIcon({
        className: "site-map-marker-wrap",
        html: `<span class="site-map-marker"><span class="site-map-marker-label">${escapeHtml(siteId)}</span><span class="site-map-marker-pin"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 21 6-18 6 18M8 15h8M9.5 10h5M11 5h2M4 21h16M8.2 14.5l7.6-4.2m-7.6 0 7.6 4.2M6.8 18h10.4"/><path d="M8 3.5a6 6 0 0 1 8 0M5.5 1a10 10 0 0 1 13 0"/></svg></span></span>`,
        iconSize: [82, 74],
        iconAnchor: [41, 72],
      }),
      title: `Site ${siteId}`,
      alt: `Site ${siteId} location`,
    }).addTo(map);
    const popup = document.createElement("strong");
    popup.textContent = `Site ${siteId}`;
    marker.bindPopup(popup);

    return () => { map.remove(); };
  }, [latitude, longitude, online, siteId]);

  return (
    <section className="site-location-card" aria-label={`Map and directions for site ${siteId}`}>
      <div className="site-location-heading">
        <div>
          <strong>Site Location</strong>
          <span>{coordinates}</span>
        </div>
        {online ? (
          <a className="site-directions-link" href={directionsUrl} target="_blank" rel="noreferrer">
            <LocationArrowIcon />
            <span>Get Directions</span>
          </a>
        ) : <span className="site-map-offline-label">Offline</span>}
      </div>
      {online ? (
        <div className="site-map-frame">
          <div ref={mapElement} className="site-map-canvas" role="application" aria-label={`Interactive map centered on site ${siteId}`} />
        </div>
      ) : (
        <div className="site-map-offline">
          <span className="site-map-offline-icon"><LocationPinIcon /></span>
          <div><strong>Map needs an internet connection</strong><span>Saved coordinates are available offline: {coordinates}</span></div>
        </div>
      )}
    </section>
  );
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}

function LocationArrowIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 3 10.8 13.2"/><path d="m21 3-6.5 18-3.7-7.8L3 9.5 21 3Z"/></svg>;
}

function LocationPinIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/></svg>;
}
