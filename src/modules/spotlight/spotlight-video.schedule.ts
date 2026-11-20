import { SpotlightVideoInput } from "./spotlight-video.types";

// Overlap detection between two video schedules. Both are read on the SAME wall clock (each salon's own timezone), so the zone cancels out
// and the maths can use plain "minutes since 1970-01-01 00:00 wall clock". The frontend's utils/videoSchedule.ts expands schedules the same
// way (kept in sync deliberately: the two codebases do not share code).

type Schedule = Pick<SpotlightVideoInput, "startDate" | "endDate" | "startTime" | "endTime" | "repeatSchedule">;
type Span = [number, number]; // [start, end) in wall-clock minutes

const MIN_PER_DAY = 1440;

const dayNumber = (isoDate: string): number => {
    const [y, m, d] = isoDate.split("-").map(Number);
    return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
};
const minutesOfDay = (hhmm: string): number => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
};

/** Every window in which the schedule is active, oldest first. */
export function expandOccurrences(s: Schedule): Span[] {
    const first = dayNumber(s.startDate);
    const last = dayNumber(s.endDate);
    const from = minutesOfDay(s.startTime);
    const to = minutesOfDay(s.endTime);

    if (s.repeatSchedule === "none") return [[first * MIN_PER_DAY + from, last * MIN_PER_DAY + to]];

    const step = s.repeatSchedule === "weekly" ? 7 : 1;
    const spans: Span[] = [];
    for (let day = first; day <= last; day += step) spans.push([day * MIN_PER_DAY + from, day * MIN_PER_DAY + to]);
    return spans;
}

/** Do the two schedules ever play at the same moment? (Windows touching end-to-start do not overlap.) */
export function schedulesOverlap(a: Schedule, b: Schedule): boolean {
    const A = expandOccurrences(a);
    const B = expandOccurrences(b);
    let i = 0;
    let j = 0;
    while (i < A.length && j < B.length) {
        if (A[i][0] < B[j][1] && B[j][0] < A[i][1]) return true;
        // Advance whichever window ends first; the other may still overlap the next one.
        if (A[i][1] <= B[j][1]) i++; else j++;
    }
    return false;
}
