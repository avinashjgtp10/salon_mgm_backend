import type { RegisterBody, LoginBody } from "./auth.types";
import type { GoogleOAuthProfile, GoogleStatePayload } from "./auth.types";
export declare const authService: {
    register(body: RegisterBody): Promise<{
        accessToken: string;
        refreshToken: string;
        isOnboardingComplete: boolean;
        user: {
            id: any;
            email: any;
            role: any;
            first_name: any;
            last_name: any;
            salonId: string | null;
        };
    }>;
    login(body: LoginBody): Promise<{
        accessToken: string;
        refreshToken: string;
        isOnboardingComplete: any;
        user: {
            id: any;
            email: any;
            role: any;
            first_name: any;
            last_name: any;
            salonId: string | null;
        };
    }>;
    refresh(refreshToken: string): Promise<{
        accessToken: string;
    }>;
    logout(refreshToken: string): Promise<{
        message: string;
    }>;
    _preRegOtpKey(email: string): string;
    sendEmailOtp(emailRaw: string): Promise<{
        message: string;
    }>;
    verifyEmailOtp(emailRaw: string, otpRaw: string): Promise<{
        message: string;
        success: boolean;
    }>;
    forgotPasswordSendOtp(emailRaw: string): Promise<{
        message: string;
    }>;
    forgotPasswordVerifyOtp(emailRaw: string, otpRaw: string): Promise<{
        message: string;
        success: boolean;
    }>;
    resetPassword(emailRaw: string, otpRaw: string, newPasswordRaw: string): Promise<{
        message: string;
    }>;
    sendPhoneOtpExotel(emailRaw: string, phoneRaw: string): Promise<{
        message: string;
        verificationId: any;
    }>;
    verifyPhoneOtpExotel(emailRaw: string, otpRaw: string): Promise<{
        message: string;
    }>;
    googleCreateState(payload: Omit<GoogleStatePayload, "createdAt">): Promise<string>;
    googleConsumeState(state: string): Promise<GoogleStatePayload | null>;
    googleAuthUrl(params: {
        state: string;
        codeChallenge: string;
    }): string;
    googleExchangeCode(code: string, codeVerifier: string): Promise<{
        access_token: string;
        id_token: string;
    }>;
    googleGetProfile(accessToken: string): Promise<GoogleOAuthProfile>;
    signInWithGoogle(profile: GoogleOAuthProfile): Promise<{
        user: any;
        accessToken: string;
        refreshToken: string;
        salonId: string | null;
        isOnboardingComplete: any;
    }>;
    googleMakePkce(): {
        codeVerifier: string;
        codeChallenge: string;
    };
};
//# sourceMappingURL=auth.service.d.ts.map