import type { RegisterBody, LoginBody } from "./auth.types";
import type { GoogleOAuthProfile, GoogleStatePayload } from "./auth.types";
export declare const authService: {
    register(body: RegisterBody): Promise<any>;
    login(body: LoginBody): Promise<{
        accessToken: string;
        refreshToken: string;
        user: {
            id: any;
            email: any;
            role: any;
            first_name: any;
            last_name: any;
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
    }>;
    googleMakePkce(): {
        codeVerifier: string;
        codeChallenge: string;
    };
};
//# sourceMappingURL=auth.service.d.ts.map