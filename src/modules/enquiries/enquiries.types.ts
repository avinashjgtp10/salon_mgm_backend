// "Contacted" and "Lost" added for the Enquiry Report's status vocabulary —
// "Closed" is kept alongside "Lost" (not replaced) so existing enquiries
// already marked "Closed" and any code branching on that value are
// unaffected.
export type EnquiryStatus = "New" | "Contacted" | "Follow-up" | "Converted" | "Closed" | "Lost";

export const ENQUIRY_STATUSES: EnquiryStatus[] = ["New", "Contacted", "Follow-up", "Converted", "Closed", "Lost"];

export type Enquiry = {
    id: string;
    salon_id: string;
    enquiry_no: number;
    name: string;
    phone: string;
    service_id: string | null;
    service_name: string | null;
    staff_id: string | null;
    staff_name: string | null;
    status: EnquiryStatus;
    notes: string | null;
    source: string | null;
    follow_up_at: string | null;
    created_at: string;
    updated_at: string;
};

export type CreateEnquiryBody = {
    name: string;
    phone: string;
    service_id?: string | null;
    staff_id?: string | null;
    status?: EnquiryStatus;
    notes?: string | null;
    source?: string | null;
    follow_up_at?: string | null;
};

export type UpdateEnquiryBody = Partial<CreateEnquiryBody>;

export type ListEnquiriesQuery = {
    search?: string;
    status?: EnquiryStatus;
    start_date?: string;
    end_date?: string;
    startDate?: string;
    endDate?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
};

export type Pagination = {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
};

export type EnquiryListResponse = {
    data: Enquiry[];
    pagination: Pagination;
};
