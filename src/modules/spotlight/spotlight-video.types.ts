export type VideoRepeat = "none" | "daily" | "weekly";
export type VideoPlayerSize = "compact" | "expanded";
export type VideoPlaybackBehavior = "once" | "loop";

// camelCase API shape, mirrored by the frontend's SpotlightVideo type.
export interface SpotlightVideo {
    id: string;
    title: string;
    youtubeUrl: string;
    youtubeVideoId: string;
    description: string | null;
    isEnabled: boolean;
    showFloatingPlayer: boolean;
    autoPlay: boolean;
    playerSize: VideoPlayerSize;
    startDate: string;            // YYYY-MM-DD
    endDate: string;              // YYYY-MM-DD, inclusive
    startTime: string;            // HH:MM, 24h
    endTime: string;              // HH:MM, 24h
    playbackDurationMinutes: number;
    playbackBehavior: VideoPlaybackBehavior;
    repeatSchedule: VideoRepeat;
    priority: number;             // higher wins when schedules overlap
    createdAt: string;
    updatedAt: string;
}

export type SpotlightVideoInput = Omit<SpotlightVideo, "id" | "youtubeVideoId" | "createdAt" | "updatedAt">;
