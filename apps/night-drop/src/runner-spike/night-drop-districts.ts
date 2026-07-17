import type { SpatialRouteSegmentKind } from "@hustle/routerun";

export type NightDropDistrictId = "glasshouse" | "night-market" | "service-quarter" | "canal-works" | "upper-heights";

export interface NightDropDistrictProfile {
  readonly id: NightDropDistrictId;
  readonly label: string;
  readonly primaryAccent: number;
  readonly secondaryAccent: number;
  readonly atmosphere: "polished" | "crowded" | "industrial" | "wet" | "premium";
}

const DISTRICTS: Readonly<Record<NightDropDistrictId, NightDropDistrictProfile>> = {
  glasshouse: {
    id: "glasshouse",
    label: "Glasshouse Heights",
    primaryAccent: 0x35e9ff,
    secondaryAccent: 0x1d8fb0,
    atmosphere: "polished",
  },
  "night-market": {
    id: "night-market",
    label: "Afterhours Market",
    primaryAccent: 0xff31c7,
    secondaryAccent: 0xff9d27,
    atmosphere: "crowded",
  },
  "service-quarter": {
    id: "service-quarter",
    label: "Service Quarter",
    primaryAccent: 0x4dd6c5,
    secondaryAccent: 0xa9ff37,
    atmosphere: "industrial",
  },
  "canal-works": {
    id: "canal-works",
    label: "Canal Works",
    primaryAccent: 0x55b6ff,
    secondaryAccent: 0xff315e,
    atmosphere: "wet",
  },
  "upper-heights": {
    id: "upper-heights",
    label: "Upper Heights",
    primaryAccent: 0xffcf33,
    secondaryAccent: 0xfff2a6,
    atmosphere: "premium",
  },
};

export function resolveNightDropDistrict(progress: number, segmentKind?: SpatialRouteSegmentKind): NightDropDistrictProfile {
  const normalized = Math.max(0, Math.min(1, progress));
  if (segmentKind === "rooftop" || segmentKind === "destination" || normalized >= .86) return DISTRICTS["upper-heights"];
  if (segmentKind === "bridge" || normalized >= .68) return DISTRICTS["canal-works"];
  if (segmentKind === "alley" || segmentKind === "tunnel" || normalized >= .48) return DISTRICTS["service-quarter"];
  if (normalized >= .24) return DISTRICTS["night-market"];
  return DISTRICTS.glasshouse;
}
