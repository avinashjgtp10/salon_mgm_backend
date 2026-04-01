export declare const waUsersRepo: {
    findBySalonId(salonId: string): Promise<any[]>;
    create(salonId: string, data: {
        name: string;
        email: string;
        passwordHash: string;
        role: string;
    }): Promise<any>;
    delete(id: string, salonId: string): Promise<boolean>;
};
//# sourceMappingURL=users.repository.d.ts.map