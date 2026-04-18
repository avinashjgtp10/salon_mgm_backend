export declare const authRepository: {
    /**
     * Find user by email
     */
    findUserByEmail(email: string): Promise<any>;
    /**
     * Find user by ID (needed for refresh token)
     */
    findUserById(userId: string): Promise<any>;
    /**
     * Create new user (supports extra registration fields)
     */
    createUser(data: {
        email: string;
        phone?: string | null;
        password_hash: string;
        first_name: string;
        last_name?: string | null;
        role: string;
        business_name?: string | null;
        address?: string | null;
        country?: string | null;
        country_code?: string | null;
    }): Promise<any>;
    /**
     * Mark user verified (after OTP verification)
     */
    markUserVerified(userId: string): Promise<any>;
    /**
     * Update last login time
     */
    updateLastLogin(userId: string): Promise<void>;
    /**
     * Update password
     */
    updatePassword(userId: string, passwordHash: string): Promise<void>;
    /**
     * Promote a user to salon_owner (used when a client creates their first salon)
     */
    upgradeToSalonOwner(userId: string): Promise<any>;
    /**
     * Get the salon ID owned by this user (null if none)
     */
    findSalonIdByUserId(userId: string): Promise<string | null>;
    /**
     * Create OTP verification entry
     * (Store HASHED OTP in otp_code column for security)
     */
    createOtpVerification(data: {
        user_id: string;
        otp_code: string;
        purpose: string;
        expires_at: Date;
    }): Promise<any>;
    /**
     * Get latest OTP for a user+purpose
     */
    findLatestOtp(userId: string, purpose: string): Promise<any>;
    /**
     * Mark OTP used
     */
    markOtpUsed(otpId: string): Promise<void>;
    /**
     * Save refresh token
     */
    saveRefreshToken(data: {
        user_id: string;
        token: string;
        expires_at: Date;
    }): Promise<any>;
    /**
     * Find refresh token
     */
    findRefreshToken(token: string): Promise<any>;
    /**
     * Delete refresh token
     */
    deleteRefreshToken(token: string): Promise<void>;
    /**
     * Delete all refresh tokens for user (optional security feature)
     */
    deleteAllRefreshTokensForUser(userId: string): Promise<void>;
    /**
     * Mark onboarding as complete for a user
     */
    markOnboardingComplete(userId: string): Promise<void>;
    findGoogleIdentity(providerUserId: string): Promise<any>;
    createUserFromGoogle(profile: {
        email: string | null;
        fullName: string | null;
        avatarUrl: string | null;
    }): Promise<any>;
    attachGoogleIdentity(userId: string, profile: {
        providerUserId: string;
        email: string | null;
    }): Promise<any>;
    updateUserBasics(userId: string, profile: {
        fullName: string | null;
        avatarUrl: string | null;
        email: string | null;
    }): Promise<any>;
};
//# sourceMappingURL=auth.repository.d.ts.map