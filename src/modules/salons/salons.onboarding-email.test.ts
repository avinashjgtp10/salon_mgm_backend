// The "onboarding complete" email goes out once, to the owner, only when onboarding really completes with the mandatory data in -
// never because the owner registered or bought a plan, and never twice however often the completion API is called.
const markOnboardingComplete = jest.fn();
const findUserById = jest.fn();
const currentPlanSummary = jest.fn();
const sendOnboardingCompleteEmail = jest.fn();

jest.mock("../auth/auth.repository", () => ({ authRepository: { markOnboardingComplete: (...a: unknown[]) => markOnboardingComplete(...a), findUserById: (...a: unknown[]) => findUserById(...a) } }));
jest.mock("./salons.repository", () => ({ salonsRepository: { currentPlanSummary: (...a: unknown[]) => currentPlanSummary(...a) } }));
jest.mock("../utils/email.service", () => ({ emailService: { sendOnboardingCompleteEmail: (...a: unknown[]) => sendOnboardingCompleteEmail(...a) } }));
jest.mock("../subscriptions/subscription-checkout.service", () => ({ subscriptionCheckoutService: {} }));
jest.mock("../auth/session.util", () => ({ issueSessionTokens: jest.fn() }));
jest.mock("../settings/tax.util", () => ({ seedUaeVatDefaults: jest.fn() }));
jest.mock("../../config/logger", () => ({ __esModule: true, default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() } }));

import { completeOnboarding } from "./salons.service";

const salon = (over: object = {}): any => ({ id: "salon-1", owner_id: "owner-1", business_name: "Glow Salon", business_type: "Hair salon", ...over });
const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
    jest.clearAllMocks();
    markOnboardingComplete.mockResolvedValue(true);
    findUserById.mockResolvedValue({ email: "owner@glow.com", first_name: "Asha" });
    currentPlanSummary.mockResolvedValue({ plan_name: "SalonOx Basic", valid_until: "2027-11-05T10:00:00Z", is_trial: false });
});

describe("completeOnboarding", () => {
    it("sends the email to the owner's registered address with the salon and plan details", async () => {
        await completeOnboarding("owner-1", salon());
        await flush();
        expect(sendOnboardingCompleteEmail).toHaveBeenCalledTimes(1);
        const m = sendOnboardingCompleteEmail.mock.calls[0][0];
        expect(m).toMatchObject({ to: "owner@glow.com", ownerName: "Asha", salonName: "Glow Salon", planName: "SalonOx Basic" });
        expect(m.validUntil).toContain("2027");
    });

    it("sends nothing when this call is not the one that completed onboarding (the API called again)", async () => {
        markOnboardingComplete.mockResolvedValue(false);
        await completeOnboarding("owner-1", salon());
        await completeOnboarding("owner-1", salon());
        await flush();
        expect(sendOnboardingCompleteEmail).not.toHaveBeenCalled();
    });

    it("sends exactly one email when the completion API is called many times at once", async () => {
        // The database flips the flag for only one of the concurrent calls.
        markOnboardingComplete.mockResolvedValueOnce(true).mockResolvedValue(false);
        await Promise.all([1, 2, 3, 4].map(() => completeOnboarding("owner-1", salon())));
        await flush();
        expect(sendOnboardingCompleteEmail).toHaveBeenCalledTimes(1);
    });

    it.each([
        ["no service category was chosen", { business_type: null }],
        ["the business name is blank", { business_name: "  " }],
    ])("sends nothing when %s (mandatory data missing)", async (_n, over) => {
        await completeOnboarding("owner-1", salon(over));
        await flush();
        expect(sendOnboardingCompleteEmail).not.toHaveBeenCalled();
    });

    it("sends nothing to someone who is not the salon's owner", async () => {
        await completeOnboarding("admin-9", salon());
        await flush();
        expect(sendOnboardingCompleteEmail).not.toHaveBeenCalled();
    });

    it("names a free trial when there is no paid plan, and leaves the plan out when there is none", async () => {
        currentPlanSummary.mockResolvedValue({ plan_name: null, valid_until: "2026-11-12T10:00:00Z", is_trial: true });
        await completeOnboarding("owner-1", salon());
        await flush();
        expect(sendOnboardingCompleteEmail.mock.calls[0][0].planName).toBe("Free Trial");

        sendOnboardingCompleteEmail.mockClear();
        currentPlanSummary.mockResolvedValue(null);
        await completeOnboarding("owner-1", salon());
        await flush();
        expect(sendOnboardingCompleteEmail.mock.calls[0][0]).toMatchObject({ planName: null, validUntil: null });
    });

    it("never fails onboarding when the email cannot be sent", async () => {
        sendOnboardingCompleteEmail.mockRejectedValueOnce(new Error("smtp down"));
        await expect(completeOnboarding("owner-1", salon())).resolves.toBeUndefined();
        await flush();
    });
});
