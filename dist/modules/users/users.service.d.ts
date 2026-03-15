import { SafeUser, UpdateUserInput } from "./users.types";
export declare const usersService: {
    me(userId: string): Promise<SafeUser>;
    list(): Promise<SafeUser[]>;
    getById(id: string): Promise<SafeUser>;
    update(id: string, input: UpdateUserInput): Promise<SafeUser>;
    remove(id: string): Promise<boolean>;
};
//# sourceMappingURL=users.service.d.ts.map