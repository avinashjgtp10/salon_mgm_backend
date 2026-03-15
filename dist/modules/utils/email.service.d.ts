export declare const emailService: {
    verifyConnection(): Promise<void>;
    sendOtpEmail(email: string, otp: string): Promise<void>;
    sendStaffInvitation(params: {
        to: string;
        token: string;
        staffFirstName: string;
        salonName: string;
    }): Promise<void>;
};
//# sourceMappingURL=email.service.d.ts.map