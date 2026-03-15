import { Client, ClientAddress, ClientEmergencyContact, ClientWithRelations, CreateClientBody, UpdateClientBody, ClientsListQuery, Paginated, MergeStrategy } from "./clients.types";
export declare const clientsRepository: {
    findById(id: string): Promise<Client | null>;
    getRelations(clientId: string): Promise<{
        addresses: ClientAddress[];
        emergency_contacts: ClientEmergencyContact[];
    }>;
    getByIdWithRelations(id: string): Promise<ClientWithRelations | null>;
    list(q: ClientsListQuery): Promise<Paginated<Client>>;
    create(body: CreateClientBody): Promise<Client>;
    update(clientId: string, patch: UpdateClientBody): Promise<Client>;
    replaceUpsertAddresses(clientId: string, items: Array<any>): Promise<void>;
    replaceUpsertEmergencyContacts(clientId: string, items: Array<any>): Promise<void>;
    softDelete(clientId: string): Promise<void>;
    hardDelete(clientId: string): Promise<void>;
    blockClients(ids: string[], reason: string): Promise<void>;
    findExistingByEmailOrPhone(params: {
        email?: string | null;
        phone_country_code?: string | null;
        phone_number?: string | null;
    }): Promise<Client | null>;
    findDuplicatesByPhone(phone_number: string): Promise<Client[]>;
    mergeClients(params: {
        targetId: string;
        sourceIds: string[];
        strategy: MergeStrategy;
    }): Promise<{
        target_client_id: string;
        merged_source_client_ids: string[];
        archived_source_client_ids: string[];
        updated_fields: string[];
    }>;
    findAllDuplicateGroups(): Promise<Record<string, Client[]>>;
};
//# sourceMappingURL=clients.repository.d.ts.map