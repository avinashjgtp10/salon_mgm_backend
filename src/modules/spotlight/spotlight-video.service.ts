import { AppError } from "../../middleware/error.middleware";
import { spotlightVideoRepository } from "./spotlight-video.repository";
import { schedulesOverlap } from "./spotlight-video.schedule";
import { SpotlightVideo, SpotlightVideoInput } from "./spotlight-video.types";

// Same URL shapes the frontend's youtube.ts accepts (watch / youtu.be / embed / shorts); extracted here as well so a bad value can never
// reach the table through a direct API call that skips the form.
const YOUTUBE_ID_RE = /(?:youtube(?:-nocookie)?\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_RANGE_DAYS = 1830; // ~5 years: keeps the overlap check cheap and catches a typo'd year

const bad = (message: string) => new AppError(400, message, "VALIDATION_ERROR");
const isRealDate = (s: string) => DATE_RE.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const minutes = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };

type Normalized = SpotlightVideoInput & { youtubeVideoId: string };

/** Checks every field of a COMPLETE video (create body, or stored row + patch) and returns the cleaned values. */
function validate(raw: Partial<SpotlightVideoInput>): Normalized {
    const title = typeof raw.title === "string" ? raw.title.trim() : "";
    if (!title) throw bad("Video title is required");
    if (title.length > 200) throw bad("Video title must be at most 200 characters");

    const youtubeUrl = typeof raw.youtubeUrl === "string" ? raw.youtubeUrl.trim() : "";
    const match = youtubeUrl.match(YOUTUBE_ID_RE);
    if (!match) throw bad("Enter a valid YouTube URL (youtube.com/watch?v=..., youtu.be/... or a Shorts link)");

    const description = typeof raw.description === "string" && raw.description.trim() ? raw.description.trim() : null;
    if (description && description.length > 1000) throw bad("Description must be at most 1000 characters");

    for (const [label, v] of [["isEnabled", raw.isEnabled], ["showFloatingPlayer", raw.showFloatingPlayer], ["autoPlay", raw.autoPlay]] as const) {
        if (typeof v !== "boolean") throw bad(`${label} must be true or false`);
    }
    if (raw.playerSize !== "compact" && raw.playerSize !== "expanded") throw bad("playerSize must be compact or expanded");
    if (raw.playbackBehavior !== "once" && raw.playbackBehavior !== "loop") throw bad("playbackBehavior must be once or loop");
    if (raw.repeatSchedule !== "none" && raw.repeatSchedule !== "daily" && raw.repeatSchedule !== "weekly") throw bad("repeatSchedule must be none, daily or weekly");

    if (typeof raw.startDate !== "string" || !isRealDate(raw.startDate)) throw bad("Start date is required (YYYY-MM-DD)");
    if (typeof raw.endDate !== "string" || !isRealDate(raw.endDate)) throw bad("End date is required (YYYY-MM-DD)");
    if (raw.endDate < raw.startDate) throw bad("End date cannot be before the start date");
    const spanDays = (Date.parse(raw.endDate) - Date.parse(raw.startDate)) / 86_400_000;
    if (spanDays > MAX_RANGE_DAYS) throw bad("The date range cannot be longer than 5 years");

    if (typeof raw.startTime !== "string" || !TIME_RE.test(raw.startTime)) throw bad("Start time is required (HH:MM)");
    if (typeof raw.endTime !== "string" || !TIME_RE.test(raw.endTime)) throw bad("End time is required (HH:MM)");
    // A window that runs inside one day must end after it starts. Only a continuous (non-repeating) multi-day schedule may end at an earlier
    // clock time than it starts, because its end is on a later date.
    const sameDayWindow = raw.repeatSchedule !== "none" || raw.startDate === raw.endDate;
    if (sameDayWindow && minutes(raw.endTime) <= minutes(raw.startTime)) throw bad("End time must be after the start time");

    const duration = raw.playbackDurationMinutes;
    if (typeof duration !== "number" || !Number.isInteger(duration) || duration < 1 || duration > 1440) {
        throw bad("Playback duration must be a whole number of minutes between 1 and 1440");
    }
    const priority = raw.priority;
    if (typeof priority !== "number" || !Number.isInteger(priority) || priority < 0 || priority > 1000) {
        throw bad("Priority must be a whole number between 0 and 1000");
    }

    return {
        title, youtubeUrl, youtubeVideoId: match[1], description,
        isEnabled: raw.isEnabled as boolean, showFloatingPlayer: raw.showFloatingPlayer as boolean, autoPlay: raw.autoPlay as boolean,
        playerSize: raw.playerSize, startDate: raw.startDate, endDate: raw.endDate, startTime: raw.startTime, endTime: raw.endTime,
        playbackDurationMinutes: duration, playbackBehavior: raw.playbackBehavior, repeatSchedule: raw.repeatSchedule, priority,
    };
}

/** Two videos that can both appear, overlap in time and have the SAME priority leave "which one plays?" undecided: refuse to save that. */
async function assertNoPriorityConflict(candidate: Normalized, excludeId?: string): Promise<void> {
    if (!candidate.isEnabled || !candidate.showFloatingPlayer) return;
    const others = (await spotlightVideoRepository.listAll()).filter(
        (o) => o.id !== excludeId && o.isEnabled && o.showFloatingPlayer && o.priority === candidate.priority,
    );
    const clash = others.find((o) => schedulesOverlap(candidate, o));
    if (clash) {
        throw new AppError(
            409,
            `This schedule overlaps "${clash.title}" and both have priority ${candidate.priority}. Give one of them a higher priority or change the schedule.`,
            "SCHEDULE_CONFLICT",
        );
    }
}

const getOrThrow = async (id: string): Promise<SpotlightVideo> => {
    const found = await spotlightVideoRepository.findById(id);
    if (!found) throw new AppError(404, "Spotlight video not found", "SPOTLIGHT_VIDEO_NOT_FOUND");
    return found;
};

export const spotlightVideoService = {
    listAll: () => spotlightVideoRepository.listAll(),

    /** For every salon user. `serverTime` lets the browser correct for a device clock that is wrong. */
    async listPlayable(): Promise<{ videos: SpotlightVideo[]; serverTime: string }> {
        return { videos: await spotlightVideoRepository.listPlayable(), serverTime: new Date().toISOString() };
    },

    async create(body: Partial<SpotlightVideoInput>, createdBy: string): Promise<SpotlightVideo> {
        const clean = validate(body);
        await assertNoPriorityConflict(clean);
        return spotlightVideoRepository.create(clean, createdBy);
    },

    async update(id: string, patch: Partial<SpotlightVideoInput>): Promise<SpotlightVideo> {
        const existing = await getOrThrow(id);
        // A partial update may send only the fields that changed: validate the stored row WITH the patch applied, as a whole.
        const { id: _id, youtubeVideoId: _v, createdAt: _c, updatedAt: _u, ...stored } = existing;
        const clean = validate({ ...stored, ...patch });
        await assertNoPriorityConflict(clean, id);
        const updated = await spotlightVideoRepository.update(id, clean);
        if (!updated) throw new AppError(404, "Spotlight video not found", "SPOTLIGHT_VIDEO_NOT_FOUND");
        return updated;
    },

    async remove(id: string): Promise<void> {
        await getOrThrow(id);
        await spotlightVideoRepository.remove(id);
    },
};
