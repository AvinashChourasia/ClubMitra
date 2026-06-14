// City → coordinates for the race-calendar map. Races from MarathonMitra carry a
// city name (and a venue string) but no lat/lng, so we map the city to a pin.
// Covers the cities that actually host marathons in India, with the common
// alt-spellings aliased (Bangalore/Bengaluru, Mysore/Mysuru, …). A race in a
// city we don't know simply isn't plotted (the map surfaces a "not shown" note).

type LatLng = { latitude: number; longitude: number };

const CITY_COORDS: Record<string, LatLng> = {
  mumbai: { latitude: 19.076, longitude: 72.8777 },
  "navi mumbai": { latitude: 19.033, longitude: 73.0297 },
  thane: { latitude: 19.2183, longitude: 72.9781 },
  delhi: { latitude: 28.6139, longitude: 77.209 },
  "new delhi": { latitude: 28.6139, longitude: 77.209 },
  noida: { latitude: 28.5355, longitude: 77.391 },
  gurgaon: { latitude: 28.4595, longitude: 77.0266 },
  gurugram: { latitude: 28.4595, longitude: 77.0266 },
  faridabad: { latitude: 28.4089, longitude: 77.3178 },
  bengaluru: { latitude: 12.9716, longitude: 77.5946 },
  bangalore: { latitude: 12.9716, longitude: 77.5946 },
  hyderabad: { latitude: 17.385, longitude: 78.4867 },
  ahmedabad: { latitude: 23.0225, longitude: 72.5714 },
  chennai: { latitude: 13.0827, longitude: 80.2707 },
  kolkata: { latitude: 22.5726, longitude: 88.3639 },
  pune: { latitude: 18.5204, longitude: 73.8567 },
  jaipur: { latitude: 26.9124, longitude: 75.7873 },
  surat: { latitude: 21.1702, longitude: 72.8311 },
  lucknow: { latitude: 26.8467, longitude: 80.9462 },
  kanpur: { latitude: 26.4499, longitude: 80.3319 },
  nagpur: { latitude: 21.1458, longitude: 79.0882 },
  indore: { latitude: 22.7196, longitude: 75.8577 },
  bhopal: { latitude: 23.2599, longitude: 77.4126 },
  visakhapatnam: { latitude: 17.6868, longitude: 83.2185 },
  vizag: { latitude: 17.6868, longitude: 83.2185 },
  patna: { latitude: 25.5941, longitude: 85.1376 },
  vadodara: { latitude: 22.3072, longitude: 73.1812 },
  baroda: { latitude: 22.3072, longitude: 73.1812 },
  coimbatore: { latitude: 11.0168, longitude: 76.9558 },
  kochi: { latitude: 9.9312, longitude: 76.2673 },
  cochin: { latitude: 9.9312, longitude: 76.2673 },
  chandigarh: { latitude: 30.7333, longitude: 76.7794 },
  guwahati: { latitude: 26.1445, longitude: 91.7362 },
  mysuru: { latitude: 12.2958, longitude: 76.6394 },
  mysore: { latitude: 12.2958, longitude: 76.6394 },
  thiruvananthapuram: { latitude: 8.5241, longitude: 76.9366 },
  trivandrum: { latitude: 8.5241, longitude: 76.9366 },
  bhubaneswar: { latitude: 20.2961, longitude: 85.8245 },
  nashik: { latitude: 19.9975, longitude: 73.7898 },
  goa: { latitude: 15.4909, longitude: 73.8278 },
  panaji: { latitude: 15.4909, longitude: 73.8278 },
  dehradun: { latitude: 30.3165, longitude: 78.0322 },
  udaipur: { latitude: 24.5854, longitude: 73.7125 },
  mangaluru: { latitude: 12.9141, longitude: 74.856 },
  mangalore: { latitude: 12.9141, longitude: 74.856 },
  kozhikode: { latitude: 11.2588, longitude: 75.7804 },
  calicut: { latitude: 11.2588, longitude: 75.7804 },
  madurai: { latitude: 9.9252, longitude: 78.1198 },
  amritsar: { latitude: 31.634, longitude: 74.8723 },
  jodhpur: { latitude: 26.2389, longitude: 73.0243 },
  raipur: { latitude: 21.2514, longitude: 81.6296 },
  ranchi: { latitude: 23.3441, longitude: 85.3096 },
  shimla: { latitude: 31.1048, longitude: 77.1734 },
  leh: { latitude: 34.1526, longitude: 77.577 },
  ooty: { latitude: 11.4064, longitude: 76.6932 },
  puducherry: { latitude: 11.9416, longitude: 79.8083 },
  pondicherry: { latitude: 11.9416, longitude: 79.8083 },
  siliguri: { latitude: 26.7271, longitude: 88.3953 },
  darjeeling: { latitude: 27.036, longitude: 88.2627 },
  rishikesh: { latitude: 30.0869, longitude: 78.2676 },
  hampi: { latitude: 15.335, longitude: 76.46 },
  satara: { latitude: 17.6805, longitude: 74.0183 },
  kolhapur: { latitude: 16.705, longitude: 74.2433 },
  belagavi: { latitude: 15.8497, longitude: 74.4977 },
  belgaum: { latitude: 15.8497, longitude: 74.4977 },
  hubballi: { latitude: 15.3647, longitude: 75.124 },
  hubli: { latitude: 15.3647, longitude: 75.124 },
  vijayawada: { latitude: 16.5062, longitude: 80.648 },
  varanasi: { latitude: 25.3176, longitude: 82.9739 },
  agra: { latitude: 27.1767, longitude: 78.0081 },
  jammu: { latitude: 32.7266, longitude: 74.857 },
  srinagar: { latitude: 34.0837, longitude: 74.7973 },
};

// cityCoord resolves a race's city to a pin location. Exact match first, then a
// prefix-tolerant fallback so "Bengaluru Urban" / "Pune District" still land.
export function cityCoord(city: string | null | undefined): LatLng | null {
  if (!city) return null;
  const key = city.trim().toLowerCase();
  if (!key) return null;
  if (CITY_COORDS[key]) return CITY_COORDS[key];
  for (const k of Object.keys(CITY_COORDS)) {
    if (key.startsWith(k) || k.startsWith(key)) return CITY_COORDS[k];
  }
  return null;
}
