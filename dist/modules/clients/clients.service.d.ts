import { Client, ClientWithRelations, CreateClientBody, UpdateClientBody, ClientsListQuery, ClientsImportMode, ClientsImportResult, ClientsMergeBody } from "./clients.types";
export declare const clientsService: {
    list(query: ClientsListQuery): Promise<import("./clients.types").Paginated<Client>>;
    create(body: CreateClientBody): Promise<ClientWithRelations>;
    getById(clientId: string, include?: string): Promise<ClientWithRelations>;
    update(clientId: string, patch: UpdateClientBody): Promise<ClientWithRelations>;
    remove(clientId: string, hard?: boolean): Promise<void>;
    blockClients(ids: string[], reason: string): Promise<void>;
    importClients(params: {
        rows: Array<any>;
        mode: ClientsImportMode;
        dry_run: boolean;
    }): Promise<ClientsImportResult>;
    findDuplicatesByPhone(phone_number: string): Promise<Client[]>;
    mergeClients(body: ClientsMergeBody): Promise<{
        target_client_id: string;
        merged_source_client_ids: string[];
        archived_source_client_ids: string[];
        updated_fields: string[];
    }>;
    mergeAllDuplicates(): Promise<{
        total_groups: number;
        total_merged: number;
        total_archived: number;
        results: Array<{
            phone_number: string;
            target_client_id: string;
            archived_client_ids: string[];
            updated_fields: string[];
        }>;
        errors: Array<{
            phone_number: string;
            message: string;
        }>;
    }>;
};
//# sourceMappingURL=clients.service.d.ts.map