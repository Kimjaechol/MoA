/**
 * Navigation & Directions Tool
 *
 * Provides route finding and directions using multiple providers:
 * - Kakao Map / Kakao Navi (카카오맵/카카오내비)
 * - Naver Map (네이버 지도)
 * - Google Maps (구글 맵)
 *
 * Features:
 * - Multi-modal directions (driving, transit, walking, cycling)
 * - Real-time traffic consideration
 * - ETA and distance calculation
 * - Deep links to navigation apps
 */

// ============================================
// Types
// ============================================

export type TransportMode = "driving" | "transit" | "walking" | "cycling";

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface Location {
  name: string;
  address?: string;
  coordinates?: Coordinates;
}

export interface RouteStep {
  instruction: string;
  distance: string;
  duration: string;
  mode?: string; // For transit: bus, subway, walk
  lineInfo?: string; // Bus number, subway line
}

export interface TransitInfo {
  type: "bus" | "subway" | "train" | "walk";
  lineName: string;
  lineNumber?: string;
  departureStop: string;
  arrivalStop: string;
  numStops?: number;
  duration: string;
  color?: string;
}

export interface RouteResult {
  success: boolean;
  provider: "kakao" | "naver" | "google";
  origin: Location;
  destination: Location;
  mode: TransportMode;
  summary: {
    distance: string;
    duration: string;
    trafficDuration?: string; // With traffic
    fare?: string; // For transit
  };
  steps?: RouteStep[];
  transitInfo?: TransitInfo[];
  alternatives?: Array<{
    distance: string;
    duration: string;
    summary: string;
  }>;
  deepLinks: {
    kakaoMap?: string;
    kakaoNavi?: string;
    naverMap?: string;
    googleMaps?: string;
  };
  error?: string;
}

export interface GeocodingResult {
  success: boolean;
  location?: Location;
  error?: string;
}

// ============================================
// API Configuration
// ============================================

interface NavigationConfig {
  kakaoApiKey?: string;
  naverClientId?: string;
  naverClientSecret?: string;
  googleMapsApiKey?: string;
}

function getConfig(): NavigationConfig {
  return {
    kakaoApiKey: process.env.KAKAO_REST_API_KEY ?? process.env.KAKAO_ADMIN_KEY,
    naverClientId: process.env.NAVER_CLIENT_ID,
    naverClientSecret: process.env.NAVER_CLIENT_SECRET,
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY,
  };
}

// ============================================
// Kakao Map API
// ============================================

/**
 * Geocode address to coordinates using Kakao Local API
 */
export async function kakaoGeocode(query: string): Promise<GeocodingResult> {
  const config = getConfig();
  if (!config.kakaoApiKey) {
    return { success: false, error: "Kakao API key not configured" };
  }

  try {
    const url = new URL("https://dapi.kakao.com/v2/local/search/keyword.json");
    url.searchParams.set("query", query);

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `KakaoAK ${config.kakaoApiKey}`,
      },
    });

    if (!response.ok) {
      return { success: false, error: `Kakao API error: ${response.status}` };
    }

    const data = await response.json() as {
      documents: Array<{
        place_name: string;
        address_name: string;
        road_address_name?: string;
        x: string;
        y: string;
      }>;
    };

    if (data.documents.length === 0) {
      return { success: false, error: "장소를 찾을 수 없습니다" };
    }

    const place = data.documents[0];
    return {
      success: true,
      location: {
        name: place.place_name,
        address: place.road_address_name ?? place.address_name,
        coordinates: {
          lat: parseFloat(place.y),
          lng: parseFloat(place.x),
        },
      },
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Geocoding failed" };
  }
}

/**
 * Get directions using Kakao Mobility API
 */
export async function kakaoDirections(
  origin: Location,
  destination: Location,
  mode: TransportMode = "driving",
): Promise<RouteResult> {
  const config = getConfig();

  // Geocode if coordinates not provided
  let originCoords = origin.coordinates;
  let destCoords = destination.coordinates;

  if (!originCoords) {
    const geocoded = await kakaoGeocode(origin.name);
    if (!geocoded.success || !geocoded.location?.coordinates) {
      return {
        success: false,
        provider: "kakao",
        origin,
        destination,
        mode,
        summary: { distance: "", duration: "" },
        deepLinks: {},
        error: `출발지를 찾을 수 없습니다: ${origin.name}`,
      };
    }
    originCoords = geocoded.location.coordinates;
    origin = { ...origin, ...geocoded.location };
  }

  if (!destCoords) {
    const geocoded = await kakaoGeocode(destination.name);
    if (!geocoded.success || !geocoded.location?.coordinates) {
      return {
        success: false,
        provider: "kakao",
        origin,
        destination,
        mode,
        summary: { distance: "", duration: "" },
        deepLinks: {},
        error: `도착지를 찾을 수 없습니다: ${destination.name}`,
      };
    }
    destCoords = geocoded.location.coordinates;
    destination = { ...destination, ...geocoded.location };
  }

  // Generate deep links
  const deepLinks = generateKakaoDeepLinks(originCoords, destCoords, origin.name, destination.name);

  // For transit, use Kakao public transit API
  if (mode === "transit") {
    return await kakaoTransitDirections(origin, destination, originCoords, destCoords, deepLinks);
  }

  // For driving, use Kakao Mobility API
  if (!config.kakaoApiKey) {
    // Return with deep links only
    return {
      success: true,
      provider: "kakao",
      origin,
      destination,
      mode,
      summary: {
        distance: "카카오맵에서 확인",
        duration: "카카오맵에서 확인",
      },
      deepLinks,
    };
  }

  try {
    const url = new URL("https://apis-navi.kakaomobility.com/v1/directions");
    url.searchParams.set("origin", `${originCoords.lng},${originCoords.lat}`);
    url.searchParams.set("destination", `${destCoords.lng},${destCoords.lat}`);
    url.searchParams.set("priority", "RECOMMEND"); // RECOMMEND, TIME, DISTANCE

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `KakaoAK ${config.kakaoApiKey}`,
      },
    });

    if (!response.ok) {
      // Fallback to deep links
      return {
        success: true,
        provider: "kakao",
        origin,
        destination,
        mode,
        summary: {
          distance: "카카오맵에서 확인",
          duration: "카카오맵에서 확인",
        },
        deepLinks,
      };
    }

    const data = await response.json() as {
      routes: Array<{
        summary: {
          distance: number;
          duration: number;
        };
        sections: Array<{
          distance: number;
          duration: number;
          guides: Array<{
            type: number;
            guidance: string;
            distance: number;
            duration: number;
          }>;
        }>;
      }>;
    };

    if (!data.routes || data.routes.length === 0) {
      return {
        success: true,
        provider: "kakao",
        origin,
        destination,
        mode,
        summary: {
          distance: "경로를 찾을 수 없음",
          duration: "경로를 찾을 수 없음",
        },
        deepLinks,
      };
    }

    const route = data.routes[0];
    const steps: RouteStep[] = [];

    for (const section of route.sections) {
      for (const guide of section.guides) {
        steps.push({
          instruction: guide.guidance,
          distance: formatDistance(guide.distance),
          duration: formatDuration(guide.duration),
        });
      }
    }

    return {
      success: true,
      provider: "kakao",
      origin,
      destination,
      mode,
      summary: {
        distance: formatDistance(route.summary.distance),
        duration: formatDuration(route.summary.duration),
      },
      steps,
      deepLinks,
    };
  } catch (err) {
    return {
      success: true,
      provider: "kakao",
      origin,
      destination,
      mode,
      summary: {
        distance: "카카오맵에서 확인",
        duration: "카카오맵에서 확인",
      },
      deepLinks,
      error: err instanceof Error ? err.message : "Direction API error",
    };
  }
}

/**
 * Get transit directions using Kakao
 */
async function kakaoTransitDirections(
  origin: Location,
  destination: Location,
  originCoords: Coordinates,
  destCoords: Coordinates,
  deepLinks: RouteResult["deepLinks"],
): Promise<RouteResult> {
  // Kakao doesn't have a public transit API directly accessible
  // Return with deep links to Kakao Map app which has transit info
  return {
    success: true,
    provider: "kakao",
    origin,
    destination,
    mode: "transit",
    summary: {
      distance: "카카오맵에서 확인",
      duration: "카카오맵에서 확인",
    },
    deepLinks,
  };
}

/**
 * Generate Kakao deep links
 */
function generateKakaoDeepLinks(
  origin: Coordinates,
  dest: Coordinates,
  originName: string,
  destName: string,
): RouteResult["deepLinks"] {
  // Kakao Map web URL
  const kakaoMapUrl = `https://map.kakao.com/?sName=${encodeURIComponent(originName)}&eName=${encodeURIComponent(destName)}`;

  // Kakao Navi app scheme
  const kakaoNaviUrl = `kakaomap://route?sp=${origin.lat},${origin.lng}&ep=${dest.lat},${dest.lng}&by=CAR`;

  return {
    kakaoMap: kakaoMapUrl,
    kakaoNavi: kakaoNaviUrl,
  };
}

// ============================================
// Naver Map API
// ============================================

/**
 * Geocode using Naver Search API
 */
export async function naverGeocode(query: string): Promise<GeocodingResult> {
  const config = getConfig();
  if (!config.naverClientId || !config.naverClientSecret) {
    return { success: false, error: "Naver API credentials not configured" };
  }

  try {
    const url = new URL("https://openapi.naver.com/v1/search/local.json");
    url.searchParams.set("query", query);
    url.searchParams.set("display", "1");

    const response = await fetch(url.toString(), {
      headers: {
        "X-Naver-Client-Id": config.naverClientId,
        "X-Naver-Client-Secret": config.naverClientSecret,
      },
    });

    if (!response.ok) {
      return { success: false, error: `Naver API error: ${response.status}` };
    }

    const data = await response.json() as {
      items: Array<{
        title: string;
        address: string;
        roadAddress: string;
        mapx: string;
        mapy: string;
      }>;
    };

    if (data.items.length === 0) {
      return { success: false, error: "장소를 찾을 수 없습니다" };
    }

    const place = data.items[0];
    // Naver uses TM128 coordinates, need to convert
    const lng = parseInt(place.mapx) / 10000000;
    const lat = parseInt(place.mapy) / 10000000;

    return {
      success: true,
      location: {
        name: place.title.replace(/<[^>]*>/g, ""), // Remove HTML tags
        address: place.roadAddress || place.address,
        coordinates: { lat, lng },
      },
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Geocoding failed" };
  }
}

/**
 * Get directions using Naver Directions API
 */
export async function naverDirections(
  origin: Location,
  destination: Location,
  mode: TransportMode = "driving",
): Promise<RouteResult> {
  const _config = getConfig();

  // Geocode if coordinates not provided
  let originCoords = origin.coordinates;
  let destCoords = destination.coordinates;

  if (!originCoords) {
    const geocoded = await naverGeocode(origin.name);
    if (geocoded.success && geocoded.location?.coordinates) {
      originCoords = geocoded.location.coordinates;
      origin = { ...origin, ...geocoded.location };
    } else {
      // Try Kakao as fallback
      const kakaoGeocoded = await kakaoGeocode(origin.name);
      if (kakaoGeocoded.success && kakaoGeocoded.location?.coordinates) {
        originCoords = kakaoGeocoded.location.coordinates;
        origin = { ...origin, ...kakaoGeocoded.location };
      }
    }
  }

  if (!destCoords) {
    const geocoded = await naverGeocode(destination.name);
    if (geocoded.success && geocoded.location?.coordinates) {
      destCoords = geocoded.location.coordinates;
      destination = { ...destination, ...geocoded.location };
    } else {
      const kakaoGeocoded = await kakaoGeocode(destination.name);
      if (kakaoGeocoded.success && kakaoGeocoded.location?.coordinates) {
        destCoords = kakaoGeocoded.location.coordinates;
        destination = { ...destination, ...kakaoGeocoded.location };
      }
    }
  }

  if (!originCoords || !destCoords) {
    return {
      success: false,
      provider: "naver",
      origin,
      destination,
      mode,
      summary: { distance: "", duration: "" },
      deepLinks: {},
      error: "위치를 찾을 수 없습니다",
    };
  }

  // Generate deep links
  const deepLinks = generateNaverDeepLinks(originCoords, destCoords, origin.name, destination.name);

  // Naver Directions API requires business registration
  // Return with deep links
  return {
    success: true,
    provider: "naver",
    origin,
    destination,
    mode,
    summary: {
      distance: "네이버 지도에서 확인",
      duration: "네이버 지도에서 확인",
    },
    deepLinks,
  };
}

/**
 * Generate Naver deep links
 */
function generateNaverDeepLinks(
  origin: Coordinates,
  dest: Coordinates,
  originName: string,
  destName: string,
): RouteResult["deepLinks"] {
  // Naver Map web URL
  const naverMapUrl = `https://map.naver.com/v5/directions/${origin.lng},${origin.lat},${encodeURIComponent(originName)}/${dest.lng},${dest.lat},${encodeURIComponent(destName)}/-/transit?c=15,0,0,0,dh`;

  return {
    naverMap: naverMapUrl,
  };
}

// ============================================
// Google Maps API
// ============================================

/**
 * Geocode using Google Maps API
 */
export async function googleGeocode(query: string): Promise<GeocodingResult> {
  const config = getConfig();
  if (!config.googleMapsApiKey) {
    return { success: false, error: "Google Maps API key not configured" };
  }

  try {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("address", query);
    url.searchParams.set("key", config.googleMapsApiKey);
    url.searchParams.set("language", "ko");
    url.searchParams.set("region", "kr");

    const response = await fetch(url.toString());

    if (!response.ok) {
      return { success: false, error: `Google API error: ${response.status}` };
    }

    const data = await response.json() as {
      status: string;
      results: Array<{
        formatted_address: string;
        geometry: {
          location: { lat: number; lng: number };
        };
      }>;
    };

    if (data.status !== "OK" || data.results.length === 0) {
      return { success: false, error: "장소를 찾을 수 없습니다" };
    }

    const place = data.results[0];
    return {
      success: true,
      location: {
        name: query,
        address: place.formatted_address,
        coordinates: place.geometry.location,
      },
    };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Geocoding failed" };
  }
}

/**
 * Get directions using Google Maps Directions API
 */
export async function googleDirections(
  origin: Location,
  destination: Location,
  mode: TransportMode = "driving",
): Promise<RouteResult> {
  const config = getConfig();

  // Geocode if coordinates not provided
  let originCoords = origin.coordinates;
  let destCoords = destination.coordinates;

  if (!originCoords && config.googleMapsApiKey) {
    const geocoded = await googleGeocode(origin.name);
    if (geocoded.success && geocoded.location?.coordinates) {
      originCoords = geocoded.location.coordinates;
      origin = { ...origin, ...geocoded.location };
    }
  }
  if (!originCoords) {
    const geocoded = await kakaoGeocode(origin.name);
    if (geocoded.success && geocoded.location?.coordinates) {
      originCoords = geocoded.location.coordinates;
      origin = { ...origin, ...geocoded.location };
    }
  }

  if (!destCoords && config.googleMapsApiKey) {
    const geocoded = await googleGeocode(destination.name);
    if (geocoded.success && geocoded.location?.coordinates) {
      destCoords = geocoded.location.coordinates;
      destination = { ...destination, ...geocoded.location };
    }
  }
  if (!destCoords) {
    const geocoded = await kakaoGeocode(destination.name);
    if (geocoded.success && geocoded.location?.coordinates) {
      destCoords = geocoded.location.coordinates;
      destination = { ...destination, ...geocoded.location };
    }
  }

  if (!originCoords || !destCoords) {
    return {
      success: false,
      provider: "google",
      origin,
      destination,
      mode,
      summary: { distance: "", duration: "" },
      deepLinks: {},
      error: "위치를 찾을 수 없습니다",
    };
  }

  // Generate deep links
  const deepLinks = generateGoogleDeepLinks(originCoords, destCoords, origin.name, destination.name, mode);

  if (!config.googleMapsApiKey) {
    return {
      success: true,
      provider: "google",
      origin,
      destination,
      mode,
      summary: {
        distance: "구글 맵에서 확인",
        duration: "구글 맵에서 확인",
      },
      deepLinks,
    };
  }

  try {
    const googleMode = mode === "cycling" ? "bicycling" : mode;
    const url = new URL("https://maps.googleapis.com/maps/api/directions/json");
    url.searchParams.set("origin", `${originCoords.lat},${originCoords.lng}`);
    url.searchParams.set("destination", `${destCoords.lat},${destCoords.lng}`);
    url.searchParams.set("mode", googleMode);
    url.searchParams.set("key", config.googleMapsApiKey);
    url.searchParams.set("language", "ko");
    url.searchParams.set("alternatives", "true");

    const response = await fetch(url.toString());

    if (!response.ok) {
      return {
        success: true,
        provider: "google",
        origin,
        destination,
        mode,
        summary: {
          distance: "구글 맵에서 확인",
          duration: "구글 맵에서 확인",
        },
        deepLinks,
      };
    }

    const data = await response.json() as {
      status: string;
      routes: Array<{
        legs: Array<{
          distance: { text: string; value: number };
          duration: { text: string; value: number };
          duration_in_traffic?: { text: string; value: number };
          steps: Array<{
            html_instructions: string;
            distance: { text: string };
            duration: { text: string };
            travel_mode: string;
            transit_details?: {
              line: { short_name: string; name: string; vehicle: { type: string } };
              departure_stop: { name: string };
              arrival_stop: { name: string };
              num_stops: number;
            };
          }>;
        }>;
        summary: string;
        fare?: { text: string };
      }>;
    };

    if (data.status !== "OK" || data.routes.length === 0) {
      return {
        success: true,
        provider: "google",
        origin,
        destination,
        mode,
        summary: {
          distance: "경로를 찾을 수 없음",
          duration: "경로를 찾을 수 없음",
        },
        deepLinks,
      };
    }

    const route = data.routes[0];
    const leg = route.legs[0];

    const steps: RouteStep[] = leg.steps.map((step) => ({
      instruction: step.html_instructions.replace(/<[^>]*>/g, ""),
      distance: step.distance.text,
      duration: step.duration.text,
      mode: step.travel_mode.toLowerCase(),
      lineInfo: step.transit_details
        ? `${step.transit_details.line.short_name || step.transit_details.line.name}`
        : undefined,
    }));

    const transitInfo: TransitInfo[] = leg.steps
      .filter((step) => step.transit_details)
      .map((step) => ({
        type: mapGoogleVehicleType(step.transit_details!.line.vehicle.type),
        lineName: step.transit_details!.line.name,
        lineNumber: step.transit_details!.line.short_name,
        departureStop: step.transit_details!.departure_stop.name,
        arrivalStop: step.transit_details!.arrival_stop.name,
        numStops: step.transit_details!.num_stops,
        duration: step.duration.text,
      }));

    const alternatives = data.routes.slice(1).map((r) => ({
      distance: r.legs[0].distance.text,
      duration: r.legs[0].duration.text,
      summary: r.summary,
    }));

    return {
      success: true,
      provider: "google",
      origin,
      destination,
      mode,
      summary: {
        distance: leg.distance.text,
        duration: leg.duration.text,
        trafficDuration: leg.duration_in_traffic?.text,
        fare: route.fare?.text,
      },
      steps,
      transitInfo: transitInfo.length > 0 ? transitInfo : undefined,
      alternatives: alternatives.length > 0 ? alternatives : undefined,
      deepLinks,
    };
  } catch (err) {
    return {
      success: true,
      provider: "google",
      origin,
      destination,
      mode,
      summary: {
        distance: "구글 맵에서 확인",
        duration: "구글 맵에서 확인",
      },
      deepLinks,
      error: err instanceof Error ? err.message : "Direction API error",
    };
  }
}

/**
 * Map Google vehicle type to our type
 */
function mapGoogleVehicleType(type: string): TransitInfo["type"] {
  switch (type.toUpperCase()) {
    case "BUS":
    case "INTERCITY_BUS":
    case "TROLLEYBUS":
      return "bus";
    case "SUBWAY":
    case "METRO_RAIL":
      return "subway";
    case "RAIL":
    case "HEAVY_RAIL":
    case "COMMUTER_TRAIN":
    case "HIGH_SPEED_TRAIN":
    case "LONG_DISTANCE_TRAIN":
      return "train";
    default:
      return "bus";
  }
}

/**
 * Generate Google deep links
 */
function generateGoogleDeepLinks(
  origin: Coordinates,
  dest: Coordinates,
  originName: string,
  destName: string,
  mode: TransportMode,
): RouteResult["deepLinks"] {
  const travelMode = mode === "cycling" ? "bicycling" : mode;
  const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${dest.lat},${dest.lng}&travelmode=${travelMode}`;

  return {
    googleMaps: googleMapsUrl,
  };
}

// ============================================
// Unified Navigation Interface
// ============================================

export type NavigationProvider = "kakao" | "naver" | "google" | "auto";

/**
 * Get directions using the specified provider (or auto-select best available)
 */
export async function getDirections(
  origin: string | Location,
  destination: string | Location,
  options: {
    mode?: TransportMode;
    provider?: NavigationProvider;
  } = {},
): Promise<RouteResult> {
  const mode = options.mode ?? "driving";
  const provider = options.provider ?? "auto";

  // Convert string to Location
  const originLoc: Location = typeof origin === "string" ? { name: origin } : origin;
  const destLoc: Location = typeof destination === "string" ? { name: destination } : destination;

  // Auto-select provider based on availability
  if (provider === "auto") {
    const config = getConfig();

    // Prefer Kakao for Korean locations
    if (config.kakaoApiKey) {
      return await kakaoDirections(originLoc, destLoc, mode);
    }

    // Try Google
    if (config.googleMapsApiKey) {
      return await googleDirections(originLoc, destLoc, mode);
    }

    // Fall back to Naver
    if (config.naverClientId) {
      return await naverDirections(originLoc, destLoc, mode);
    }

    // No API configured, return deep links only
    return await kakaoDirections(originLoc, destLoc, mode);
  }

  switch (provider) {
    case "kakao":
      return await kakaoDirections(originLoc, destLoc, mode);
    case "naver":
      return await naverDirections(originLoc, destLoc, mode);
    case "google":
      return await googleDirections(originLoc, destLoc, mode);
    default:
      return await kakaoDirections(originLoc, destLoc, mode);
  }
}

/**
 * Get directions from all available providers
 */
export async function getDirectionsAllProviders(
  origin: string | Location,
  destination: string | Location,
  mode: TransportMode = "driving",
): Promise<RouteResult[]> {
  const config = getConfig();
  const results: RouteResult[] = [];

  const originLoc: Location = typeof origin === "string" ? { name: origin } : origin;
  const destLoc: Location = typeof destination === "string" ? { name: destination } : destination;

  // Get from Kakao (default for Korean)
  const kakaoResult = await kakaoDirections(originLoc, destLoc, mode);
  results.push(kakaoResult);

  // Get from Google if available
  if (config.googleMapsApiKey) {
    const googleResult = await googleDirections(originLoc, destLoc, mode);
    results.push(googleResult);
  }

  // Get from Naver if available
  if (config.naverClientId) {
    const naverResult = await naverDirections(originLoc, destLoc, mode);
    results.push(naverResult);
  }

  return results;
}

// ============================================
// Formatting Utilities
// ============================================

/**
 * Format distance in meters to human-readable string
 */
function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  }
  return `${(meters / 1000).toFixed(1)}km`;
}

/**
 * Format duration in seconds to human-readable string
 */
function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return minutes > 0 ? `${hours}시간 ${minutes}분` : `${hours}시간`;
  }
  return `${minutes}분`;
}

/**
 * Format route result for display in KakaoTalk
 */
export function formatRouteResultForKakao(result: RouteResult): string {
  if (!result.success) {
    return `❌ 경로를 찾을 수 없습니다.\n${result.error ?? ""}`;
  }

  const modeEmoji = {
    driving: "🚗",
    transit: "🚌",
    walking: "🚶",
    cycling: "🚴",
  };

  const lines: string[] = [];

  lines.push(`${modeEmoji[result.mode]} **길찾기 결과**\n`);
  lines.push(`📍 출발: ${result.origin.name}`);
  lines.push(`📍 도착: ${result.destination.name}\n`);

  lines.push(`📏 거리: ${result.summary.distance}`);
  lines.push(`⏱️ 예상 시간: ${result.summary.duration}`);

  if (result.summary.trafficDuration) {
    lines.push(`🚦 교통 반영: ${result.summary.trafficDuration}`);
  }

  if (result.summary.fare) {
    lines.push(`💰 요금: ${result.summary.fare}`);
  }

  // Transit information
  if (result.transitInfo && result.transitInfo.length > 0) {
    lines.push("\n🚌 **대중교통 정보**");
    for (const transit of result.transitInfo) {
      const typeEmoji = {
        bus: "🚌",
        subway: "🚇",
        train: "🚆",
        walk: "🚶",
      };
      const info = transit.lineNumber
        ? `${typeEmoji[transit.type]} ${transit.lineNumber} (${transit.lineName})`
        : `${typeEmoji[transit.type]} ${transit.lineName}`;
      lines.push(`${info}`);
      lines.push(`   ${transit.departureStop} → ${transit.arrivalStop}`);
      if (transit.numStops) {
        lines.push(`   ${transit.numStops}정거장, ${transit.duration}`);
      }
    }
  }

  // Alternative routes
  if (result.alternatives && result.alternatives.length > 0) {
    lines.push("\n📋 **대안 경로**");
    result.alternatives.forEach((alt, i) => {
      lines.push(`${i + 1}. ${alt.summary}: ${alt.duration} (${alt.distance})`);
    });
  }

  // Deep links
  lines.push("\n🗺️ **앱으로 보기**");
  if (result.deepLinks.kakaoMap) {
    lines.push(`• 카카오맵: ${result.deepLinks.kakaoMap}`);
  }
  if (result.deepLinks.naverMap) {
    lines.push(`• 네이버 지도: ${result.deepLinks.naverMap}`);
  }
  if (result.deepLinks.googleMaps) {
    lines.push(`• 구글 맵: ${result.deepLinks.googleMaps}`);
  }

  return lines.join("\n");
}

// ============================================
// Command Parser
// ============================================

/**
 * Parse navigation command from user message
 */
export function parseNavigationCommand(message: string): {
  isNavigationCommand: boolean;
  origin?: string;
  destination?: string;
  mode?: TransportMode;
} {
  const normalized = message.trim().toLowerCase();

  // Navigation keywords
  const navKeywords = [
    "길찾기", "길 찾기", "경로", "가는 길", "가는길",
    "어떻게 가", "어떻게가", "얼마나 걸", "얼마나걸",
    "몇 분", "몇분", "시간이 얼마나", "소요 시간", "소요시간",
    "버스", "지하철", "대중교통", "차로", "자동차로", "운전",
    "걸어서", "도보로", "자전거로",
    "네비", "내비", "navigation", "directions", "route",
  ];

  const isNavigationCommand = navKeywords.some((kw) => normalized.includes(kw));

  if (!isNavigationCommand) {
    return { isNavigationCommand: false };
  }

  // Determine transport mode
  let mode: TransportMode = "driving";
  if (/버스|지하철|대중교통|transit/.test(normalized)) {
    mode = "transit";
  } else if (/걸어|도보|walking/.test(normalized)) {
    mode = "walking";
  } else if (/자전거|cycling|bicycle/.test(normalized)) {
    mode = "cycling";
  }

  // Try to extract origin and destination
  // Pattern: "A에서 B까지", "A부터 B", "A에서 B로", "A to B"
  const patterns = [
    /(.+?)(?:에서|부터)\s*(.+?)(?:까지|로|으로|가는|갈)/,
    /(.+?)(?:에서|부터)\s*(.+)/,
    /(.+?)\s*(?:to|→|->)\s*(.+)/,
    /(.+?)(?:까지|로|으로)\s*(?:가는|갈|어떻게)/,
  ];

  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match) {
      // Clean up extracted locations
      const origin = match[1]?.trim().replace(/^(현재\s*위치|여기|지금\s*위치)$/, "현재 위치");
      const destination = match[2]?.trim()
        .replace(/어떻게.*$/, "")
        .replace(/얼마나.*$/, "")
        .replace(/몇.*$/, "")
        .trim();

      if (destination && destination.length > 1) {
        return {
          isNavigationCommand: true,
          origin: origin && origin.length > 1 ? origin : undefined,
          destination,
          mode,
        };
      }
    }
  }

  // Single destination pattern: "강남역 가는 길", "강남역 어떻게 가"
  const singleDestPatterns = [
    /(.+?)\s*(?:가는\s*길|어떻게\s*가|까지\s*어떻게|로\s*어떻게)/,
    /(.+?)\s*(?:얼마나\s*걸|몇\s*분)/,
  ];

  for (const pattern of singleDestPatterns) {
    const match = message.match(pattern);
    if (match) {
      const destination = match[1]?.trim();
      if (destination && destination.length > 1) {
        return {
          isNavigationCommand: true,
          destination,
          mode,
        };
      }
    }
  }

  return { isNavigationCommand: true, mode };
}

/**
 * Check if message is a navigation-related query
 */
export function isNavigationQuery(message: string): boolean {
  return parseNavigationCommand(message).isNavigationCommand;
}
