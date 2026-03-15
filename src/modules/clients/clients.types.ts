// src/modules/clients/clients.types.ts

export type Client = {
    id: string;

    first_name: string;
    last_name: string;
    full_name: string;

    email: string | null;
    phone_country_code: string | null;
    phone_number: string | null;

    additional_email: string | null;
    additional_phone_country_code: string | null;
    additional_phone_number: string | null;

    birthday_day_month: string | null; // "MM-DD"
    birthday_year: number | null;

    gender: string | null;
    pronouns: string | null;

    client_source: string | null;
    referred_by_client_id: string | null;

    preferred_language: string | null;
    occupation: string | null;
    country: string | null;

    avatar_url: string | null;

    total_sales: string; // pg decimal returns string
    reviews_avg: string | null;
    reviews_count: number;

    is_active: boolean;
    block_reason: string | null;

    email_notifications: boolean;
    sms_notifications: boolean;
    whatsapp_notifications: boolean;

    email_marketing: boolean;
    sms_marketing: boolean;
    whatsapp_marketing: boolean;

    created_at: string;
    updated_at: string;
};

export type ClientAddress = {
    id: string;
    client_id: string;
    type: string; // home/work/otr
    address_name: string | null;
    address_line1: string | null;
    address_line2: string | null;
    apt_suite: string | null;
    district: string | null;
    city: string | null;
    region: string | null;
    postcode: string | null;
    country: string | null;
    created_at: string;
    updated_at: string;
};

export type ClientEmergencyContact = {
    id: string;
    client_id: string;
    type: string; // primary/secondary
    full_name: string;
    relationship: string | null;
    email: string | null;
    phone_country_code: string | null;
    phone_number: string | null;
    created_at: string;
    updated_at: string;
};

export type ClientWithRelations = Client & {
    addresses?: ClientAddress[];
    emergency_contacts?: ClientEmergencyContact[];
};

export type CreateClientAddressInput = Omit<ClientAddress, "id" | "client_id" | "created_at" | "updated_at">;
export type UpsertClientAddressInput = CreateClientAddressInput & { id?: string | null };

export type CreateEmergencyContactInput = Omit<ClientEmergencyContact, "id" | "client_id" | "created_at" | "updated_at">;
export type UpsertEmergencyContactInput = CreateEmergencyContactInput & { id?: string | null };

export type CreateClientBody = {
    first_name: string;
    last_name: string;

    email?: string | null;
    phone_country_code?: string | null;
    phone_number?: string | null;

    additional_email?: string | null;
    additional_phone_country_code?: string | null;
    additional_phone_number?: string | null;

    birthday_day_month?: string | null;
    birthday_year?: number | null;

    gender?: string | null;
    pronouns?: string | null;

    client_source?: string | null;
    referred_by_client_id?: string | null;

    preferred_language?: string | null;
    occupation?: string | null;
    country?: string | null;

    avatar_url?: string | null;

    addresses?: CreateClientAddressInput[];
    emergency_contacts?: CreateEmergencyContactInput[];

    email_notifications?: boolean;
    sms_notifications?: boolean;
    whatsapp_notifications?: boolean;

    email_marketing?: boolean;
    sms_marketing?: boolean;
    whatsapp_marketing?: boolean;
};

export type UpdateClientBody = Partial<CreateClientBody> & {
    is_active?: boolean;
    block_reason?: string | null;
    addresses?: UpsertClientAddressInput[];
    emergency_contacts?: UpsertEmergencyContactInput[];
};

export type ClientGroupFilter = "all" | "fresha_accounts" | "manually_added";
export type GenderFilter = "all" | "female" | "male" | "non_binary" | "prefer_not_to_say";

export type ClientsListQuery = {
    offset?: number;
    limit?: number;
    sort_by?: "created_at" | "full_name" | "total_sales";
    sort_order?: "asc" | "desc";
    search?: string;
    inactive?: boolean;
    created_from?: string; // YYYY-MM-DD
    created_to?: string;   // YYYY-MM-DD
    source?: string;       // client_source

    // filters
    client_group?: ClientGroupFilter;
    gender?: GenderFilter;
};

export type Paginated<T> = {
    items: T[];
    total: number;
    offset: number;
    limit: number;
    has_more: boolean;
};

export type ClientsImportMode = "create_only" | "upsert";

export type ClientsImportResult = {
    total_rows: number;
    imported: number;
    updated: number;
    skipped: number;
    errors: Array<{ row: number; code: string; message: string }>;
};

export type MergeStrategy = "prefer_target" | "prefer_source" | "fill_missing_from_sources";
export type ClientsMergeBody = {
    target_client_id: string;
    source_client_ids: string[];
    strategy?: MergeStrategy;
};
