import { BundleDetail, BundleListResponse, CreateAddOnGroupBody, CreateAddOnOptionBody, CreateBundleBody, CreateServiceBody, ListBundlesQuery, ListServicesQuery, Service, ServiceDetail, ServiceListResponse, UpdateAddOnGroupBody, UpdateAddOnOptionBody, UpdateBundleBody, UpdateServiceBody } from "./services.types";
export declare const servicesService: {
    list(query: ListServicesQuery): Promise<ServiceListResponse>;
    create(params: {
        requesterUserId: string;
        requesterRole?: string;
        body: CreateServiceBody;
    }): Promise<Service>;
    getById(serviceId: string): Promise<ServiceDetail>;
    update(params: {
        serviceId: string;
        requesterUserId: string;
        requesterRole?: string;
        patch: UpdateServiceBody;
    }): Promise<Service>;
    remove(serviceId: string): Promise<void>;
    listAddOnGroups(serviceId: string): Promise<import("./services.types").AddOnGroupDetail[]>;
    createAddOnGroup(params: {
        serviceId: string;
        requesterUserId: string;
        requesterRole?: string;
        body: CreateAddOnGroupBody;
    }): Promise<import("./services.types").AddOnGroup>;
    updateAddOnGroup(params: {
        serviceId: string;
        groupId: string;
        requesterUserId: string;
        requesterRole?: string;
        patch: UpdateAddOnGroupBody;
    }): Promise<import("./services.types").AddOnGroup>;
    deleteAddOnGroup(params: {
        serviceId: string;
        groupId: string;
    }): Promise<void>;
    createAddOnOption(params: {
        serviceId: string;
        groupId: string;
        requesterUserId: string;
        requesterRole?: string;
        body: CreateAddOnOptionBody;
    }): Promise<import("./services.types").AddOnOption>;
    updateAddOnOption(params: {
        serviceId: string;
        groupId: string;
        optionId: string;
        requesterUserId: string;
        requesterRole?: string;
        patch: UpdateAddOnOptionBody;
    }): Promise<import("./services.types").AddOnOption>;
    deleteAddOnOption(params: {
        serviceId: string;
        groupId: string;
        optionId: string;
    }): Promise<void>;
};
export declare const bundlesService: {
    list(query: ListBundlesQuery): Promise<BundleListResponse>;
    create(params: {
        requesterUserId: string;
        requesterRole?: string;
        body: CreateBundleBody;
    }): Promise<BundleDetail>;
    getById(bundleId: string): Promise<BundleDetail>;
    update(params: {
        bundleId: string;
        requesterUserId: string;
        requesterRole?: string;
        patch: UpdateBundleBody;
    }): Promise<BundleDetail>;
    remove(bundleId: string): Promise<void>;
};
//# sourceMappingURL=services.service.d.ts.map