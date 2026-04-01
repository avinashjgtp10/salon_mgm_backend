import { CreateUserBody, UpdateUserBody } from './users.types';
export declare const usersService: {
    getAll(salonId: string): Promise<import("./users.types").WAUser[]>;
    create(salonId: string, body: CreateUserBody): Promise<import("./users.types").WAUser>;
    update(id: string, salonId: string, body: UpdateUserBody): Promise<import("./users.types").WAUser>;
    remove(id: string, salonId: string): Promise<{
        message: string;
    }>;
};
//# sourceMappingURL=users.service.d.ts.map