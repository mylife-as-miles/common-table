export interface WeatherConditions {
  /** Local wall time in the returned area timezone. */
  time: string;
  temperatureC: number;
  feelsLikeC: number | null;
  precipitationMm: number | null;
  precipitationProbability: number | null;
  windKmh: number;
  weatherCode: number;
  isDay: boolean | null;
}

export interface WeatherReport {
  status: "ok";
  area: { latitude: number; longitude: number };
  timezone: string;
  utcOffsetSeconds: number;
  requested: { date: string; hour: number };
  fetchedAt: string;
  freshUntil: string;
  staleUntil: string;
  stale: boolean;
  current: WeatherConditions;
  dinner: WeatherConditions | null;
  dinnerStatus: "forecast" | "outside_forecast" | "past" | "unavailable";
}

export interface WeatherFailure {
  status: "error";
  code: "invalid_query" | "method_not_allowed" | "origin_rejected" | "busy" | "rate_limited" | "timeout" | "cancelled" | "unavailable";
  message: string;
}

export const weatherCodes = new Set([0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 95, 96, 99]);
