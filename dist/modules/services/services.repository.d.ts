import { AddOnGroup, AddOnGroupDetail, AddOnOption, Bundle, BundleDetail, BundleListResponse, BundleServiceItem, CreateAddOnGroupBody, CreateAddOnOptionBody, CreateBundleBody, CreateServiceBody, ListBundlesQuery, ListServicesQuery, Service, ServiceDetail, ServiceListResponse, ServiceStaff, UpdateAddOnGroupBody, UpdateAddOnOptionBody, UpdateBundleBody, UpdateServiceBody } from "./services.types";
export declare const servicesRepository: {
    findById(id: string): Promise<Service | null>;
    list(query: ListServicesQuery): Promise<ServiceListResponse>;
    listAll(query: ListServicesQuery): Promise<Service[]>;
    create(data: CreateServiceBody): Promise<Service>;
    update(id: string, patch: UpdateServiceBody): Promise<Service>;
    delete(id: string): Promise<void>;
    replaceStaff(serviceId: string, staffIds: string[]): Promise<void>;
    getStaff(serviceId: string): Promise<ServiceStaff[]>;
    listAddOnGroupsWithOptions(serviceId: string): Promise<AddOnGroupDetail[]>;
    createAddOnGroup(serviceId: string, data: CreateAddOnGroupBody): Promise<AddOnGroup>;
    updateAddOnGroup(groupId: string, patch: UpdateAddOnGroupBody): Promise<AddOnGroup>;
    deleteAddOnGroup(groupId: string): Promise<void>;
    createAddOnOption(groupId: string, data: CreateAddOnOptionBody): Promise<AddOnOption>;
    updateAddOnOption(optionId: string, patch: UpdateAddOnOptionBody): Promise<AddOnOption>;
    deleteAddOnOption(optionId: string): Promise<void>;
    getDetailById(serviceId: string): Promise<ServiceDetail | null>;
};
export declare const bundlesRepository: {
    findById(id: string): Promise<Bundle | null>;
    list(query: ListBundlesQuery): Promise<BundleListResponse>;
    listAll(query: ListBundlesQuery): Promise<Bundle[]>;
    create(data: CreateBundleBody): Promise<Bundle>;
    update(id: string, patch: UpdateBundleBody): Promise<Bundle>;
    delete(id: string): Promise<void>;
    replaceServices(bundleId: string, serviceIds: string[]): Promise<void>;
    getBundleServices(bundleId: string): Promise<BundleServiceItem[]>;
    getDetailById(bundleId: string): Promise<BundleDetail | null>;
};
//# sourceMappingURL=services.repository.d.ts.map