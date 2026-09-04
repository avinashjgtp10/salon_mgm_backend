export type SpotlightStatus = "draft" | "published" | "archived";
export type TargetAudience = "owner" | "manager" | "staff" | "all";

export interface SpotlightImage {
    imageDataUrl: string; // a real hosted URL (see spotlight.controller's uploadImage) despite the name kept for frontend-type parity
    description?: string;
}

// Mirrors the frontend's SpotlightFeature shape 1:1 (camelCase) — the
// repository maps snake_case DB columns to this at the read boundary so the
// API response needs no transformation on the frontend side.
export interface SpotlightFeature {
    id: string;
    featureName: string;
    module: string;
    moduleRoute?: string | null;
    shortDescription: string;
    whatIsThis: string;
    howItWorks: string;
    benefits: string;
    images: SpotlightImage[];
    // A YouTube link (watch/youtu.be/embed/shorts), NOT an uploaded/hosted
    // video file — the cover image (images[0]) is always what's shown by
    // default; this only decides whether a Play button appears over it,
    // embedding the YouTube player on click. Name kept for frontend-type
    // parity with the pre-existing (localStorage-era) field.
    videoDataUrl?: string | null;
    releaseDate: string;
    targetAudience: TargetAudience[];
    status: SpotlightStatus;
    createdAt: string;
    updatedAt: string;
}

export type SpotlightCreateBody = Omit<SpotlightFeature, "id" | "createdAt" | "updatedAt">;
export type SpotlightUpdateBody = Partial<SpotlightCreateBody>;
