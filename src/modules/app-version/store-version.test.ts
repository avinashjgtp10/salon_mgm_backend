import { createStoreVersionReader, parseIosLookup, parsePlayListing } from "./store-version";
import { toPublicPayload, withLiveStoreVersion } from "./app-version.service";
import { AppVersionRow } from "./app-version.types";

jest.mock("./app-version.repository", () => ({ appVersionRepository: {} }));

const row = (overrides: Partial<AppVersionRow> = {}): AppVersionRow => ({
  id: "row",
  platform: "android",
  environment: "production",
  latest_version: "1.0.1",
  minimum_supported_version: "1.0.0",
  force_update: false,
  android_store_url: "https://play.google.com/store/apps/details?id=com.salonox.app",
  ios_store_url: null,
  title: null,
  message: null,
  release_notes: [],
  updated_by: null,
  created_at: "",
  updated_at: "",
  ...overrides,
});

describe("store version parsing", () => {
  it("reads the released iOS version for the SalonOX bundle only", () => {
    expect(parseIosLookup(JSON.stringify({ results: [{ bundleId: "com.salonox.app", version: "1.0.2" }] }))).toBe("1.0.2");
    expect(parseIosLookup(JSON.stringify({ results: [{ bundleId: "com.other.app", version: "9.9.9" }] }))).toBeNull();
    expect(parseIosLookup(JSON.stringify({ resultCount: 0, results: [] }))).toBeNull();
    expect(parseIosLookup("not json")).toBeNull();
  });

  it("accepts a single unambiguous Play listing version", () => {
    expect(parsePlayListing('x[[["1.0.2"]],[[[33]]]]y')).toBe("1.0.2");
    expect(parsePlayListing('[[["1.0.2"]] [[["1.0.2"]]')).toBe("1.0.2");
    expect(parsePlayListing('[[["1.0.2"]] [[["2.0.0"]]')).toBeNull();
    expect(parsePlayListing("Varies with device")).toBeNull();
  });
});

describe("live store version reader", () => {
  it("caches results and treats network failures as unknown", async () => {
    let clock = 0;
    const fetchImpl = jest.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ ok: true, text: async () => '[[["1.0.3"]]' });
    const read = createStoreVersionReader(fetchImpl, () => clock);

    await expect(read("android")).resolves.toBeNull();
    await expect(read("android")).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    clock += 6 * 60 * 1000;
    await expect(read("android")).resolves.toBe("1.0.3");
    await expect(read("android")).resolves.toBe("1.0.3");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("advertising the live store version", () => {
  it("raises latestVersion only when the store serves something newer", () => {
    expect(withLiveStoreVersion(row(), "1.0.2").latest_version).toBe("1.0.2");
    expect(withLiveStoreVersion(row(), "1.0.0").latest_version).toBe("1.0.1");
    expect(withLiveStoreVersion(row(), null).latest_version).toBe("1.0.1");
  });

  it("offers the update without forcing it", () => {
    const payload = toPublicPayload(withLiveStoreVersion(row(), "1.0.2"), "1.0.1");
    expect(payload).toMatchObject({ latestVersion: "1.0.2", updateAvailable: true, forceUpdate: false, minimumSupportedVersion: "1.0.0" });
  });

  it("gives production iOS the App Store link when none is stored", () => {
    expect(toPublicPayload(row({ platform: "ios" })).iosStoreUrl).toBe("https://apps.apple.com/in/app/id6814854823");
    expect(toPublicPayload(row({ platform: "ios", environment: "qa" })).iosStoreUrl).toBeNull();
  });
});
