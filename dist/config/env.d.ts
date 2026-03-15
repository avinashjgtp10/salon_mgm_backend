interface Config {
    env: string;
    port: number;
    apiVersion: string;
    database: {
        host: string;
        port: number;
        name: string;
        user: string;
        password: string;
        ssl: boolean;
    };
    redis: {
        host: string;
        port: number;
        password?: string;
        db: number;
    };
    jwt: {
        secret: string;
        expiresIn: string;
        refreshSecret: string;
        refreshExpiresIn: string;
    };
    cors: {
        allowedOrigins: string[];
    };
    frontend: {
        url: string;
    };
    logging: {
        level: string;
    };
    /**
     * ✅ ADD SMTP CONFIG (NEW)
     */
    smtp: {
        host: string;
        port: number;
        user: string;
        pass: string;
        from: string;
    };
    /**
     * ✅ ADD OTP CONFIG (NEW)
     */
    otp: {
        expMinutes: number;
    };
}
declare const config: Config;
export default config;
//# sourceMappingURL=env.d.ts.map