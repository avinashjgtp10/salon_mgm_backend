// Marketplace onboarding rules: what blocks submission, what the owner sees as status, and how the public
// service list is derived from the salon's own catalog.

import {
    applyServiceSettings, businessProblems, displayStatus, locationProblems, normalizeLink, onboardingIssues, photoProblems,
    sameCoordinate, type Snapshot,
} from "./onboarding.rules";

const business = {
    name: "Glow Salon", description: "A friendly unisex salon with a calm treatment room.", phone: "+91 98765 43210",
    email: "hello@glow.in", category: "Hair salon", business_type: "salon", website: "", instagram: "",
};
const location = { address_line: "Lane 6, Koregaon Park", city: "Pune", state: "Maharashtra", country: "India", postal_code: "411001", latitude: 18.536, longitude: 73.894 };
const photo = (category: string | null, is_cover = false) => ({ category, is_cover });
const complete: Snapshot = {
    hasSlug: true,
    business,
    location: { ...location, confirmed: true },
    photos: [photo("interior", true), photo("interior"), photo("exterior")],
    services: [{ is_listed: true }],
    staff: [{ shown: true }],
    hasOpenDay: true,
    saved: { services: true, availability: true, preferences: true },
};
const stepsWithIssues = (s: Snapshot) => [...new Set(onboardingIssues(s).map((i) => i.step))];

describe("onboardingIssues", () => {
    it("has nothing to report for a complete salon", () => {
        expect(onboardingIssues(complete)).toEqual([]);
    });

    it("blocks an unconfirmed location even when every field is filled", () => {
        expect(onboardingIssues({ ...complete, location: { ...location, confirmed: false } })).toEqual([{ step: "location", message: "Press Confirm Location." }]);
    });

    it("names every step that is still missing", () => {
        expect(stepsWithIssues({
            ...complete,
            business: { ...business, description: "short" },
            location: { ...location, latitude: null, longitude: null, confirmed: false },
            photos: [],
            services: [{ is_listed: false }],
            staff: [],
            saved: { services: false, availability: false, preferences: false },
        })).toEqual(["business", "location", "photos", "services", "availability", "preferences"]);
    });
});

describe("location", () => {
    it("requires latitude and longitude", () => {
        expect(locationProblems({ ...location, latitude: null })).toContain("Select your location on the map.");
        expect(locationProblems({ ...location, longitude: NaN })).toContain("Select your location on the map.");
    });

    it("rejects a pin outside the chosen country, and other countries", () => {
        expect(locationProblems({ ...location, latitude: 25.2, longitude: 55.27 })).toContain("The map pin is not inside India.");
        expect(locationProblems({ ...location, country: "France" })).toContain("Choose India or United Arab Emirates.");
    });

    it("needs a PIN code in India but not in the UAE", () => {
        expect(locationProblems({ ...location, postal_code: "" })).toContain("Enter the 6-digit PIN code.");
        expect(locationProblems({ ...location, country: "United Arab Emirates", state: "Dubai", postal_code: "", latitude: 25.2, longitude: 55.27 })).toEqual([]);
    });

    it("treats a moved pin as a different place", () => {
        expect(sameCoordinate("18.5360000", 18.536)).toBe(true);
        expect(sameCoordinate("18.5360000", 18.537)).toBe(false);
        expect(sameCoordinate(null, 18.536)).toBe(false);
    });
});

describe("salon category", () => {
    it("is optional", () => {
        const info = {
            name: "Glow", description: "A friendly salon for hair and skin.", phone: "9876543210", email: "a@glow.com",
            category: "", business_type: "salon", website: "", instagram: "",
        };
        expect(businessProblems(info)).toEqual([]);
    });
});

describe("photos", () => {
    it("asks only for three photos, of any type, with or without a chosen cover", () => {
        expect(photoProblems([photo("interior", true), photo("exterior")])).toEqual(["Add at least 3 salon photos."]);
        expect(photoProblems([photo("portfolio"), photo("team"), photo(null)])).toEqual([]);
    });
});

describe("business information", () => {
    it("accepts optional links left empty and rejects a non-Instagram page", () => {
        expect(businessProblems(business)).toEqual([]);
        expect(businessProblems({ ...business, instagram: "https://example.com/glow" })).toHaveLength(1);
        expect(businessProblems({ ...business, website: "not a site" })).toHaveLength(1);
    });

    it("turns an Instagram username or bare domain into a link", () => {
        expect(normalizeLink("@glow.salon", true)).toBe("https://www.instagram.com/glow.salon");
        expect(normalizeLink("instagram.com/glow", true)).toBe("https://instagram.com/glow");
        expect(normalizeLink("glow.in")).toBe("https://glow.in");
    });
});

describe("displayStatus", () => {
    const row = (status: any, current_step = 3) => ({ status, current_step });
    it.each([
        [null, true, false, "not_started"],
        [row("draft"), true, false, "in_progress"],
        [row("draft", 7), true, false, "setup_incomplete"],
        [row("draft", 7), false, false, "in_progress"],
        [row("submitted"), false, false, "submitted"],
        [row("rejected"), false, false, "rejected"],
        [row("approved"), false, false, "approved"],
        [row("approved"), false, true, "active"],
    ])("%j issues=%s live=%s -> %s", (r, issues, live, expected) => {
        expect(displayStatus(r as any, issues as boolean, live as boolean)).toBe(expected);
    });
});

describe("applyServiceSettings", () => {
    const catalog = [{ id: "a", price: "500.00" }, { id: "b", price: "900.00" }, { id: "c", price: "100.00" }];

    it("hides unpublished services, applies the Marketplace price and leaves the catalog untouched", () => {
        const settings = new Map([["a", { is_listed: true, display_price: "450.00" }], ["b", { is_listed: false, display_price: null }]]);
        expect(applyServiceSettings(catalog, settings)).toEqual([{ id: "a", price: "450.00" }, { id: "c", price: "100.00" }]);
        expect(catalog[0].price).toBe("500.00");
    });

    it("keeps a Marketplace price of zero rather than falling back to the catalog price", () => {
        expect(applyServiceSettings([catalog[0]], new Map([["a", { is_listed: true, display_price: 0 }]]))).toEqual([{ id: "a", price: "0" }]);
    });
});
