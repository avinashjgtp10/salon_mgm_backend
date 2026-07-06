import { Tool } from "../ai-engine.types";
import { getSalonDetailsTool } from "./salon.tool";
import { getServicesTool, getServiceCategoriesTool } from "./catalog.tool";
import { getStaffTool } from "./staff.tool";
import { checkAvailabilityTool, suggestAvailableStaffTool } from "./availability.tool";
import {
    createAppointmentTool,
    cancelAppointmentTool,
    rescheduleAppointmentTool,
    modifyAppointmentServicesTool,
    checkAppointmentStatusTool,
    addAppointmentNoteTool,
} from "./appointments.tool";
import { getCustomerHistoryTool } from "./clients.tool";
import { getMembershipAndPackageStatusTool, getMembershipAndPackagePlansTool } from "./loyalty.tool";
import { updateCustomerMemoryTool } from "./memory.tool";
import { getOffersTool } from "./offers.tool";
import { getProductsTool } from "./products.tool";
import { handoffToReceptionistTool } from "./handoff.tool";

export const soxiTools: Tool[] = [
    getSalonDetailsTool,
    getServiceCategoriesTool,
    getServicesTool,
    getStaffTool,
    checkAvailabilityTool,
    suggestAvailableStaffTool,
    getCustomerHistoryTool,
    getMembershipAndPackageStatusTool,
    getMembershipAndPackagePlansTool,
    createAppointmentTool,
    cancelAppointmentTool,
    rescheduleAppointmentTool,
    modifyAppointmentServicesTool,
    checkAppointmentStatusTool,
    addAppointmentNoteTool,
    updateCustomerMemoryTool,
    getOffersTool,
    getProductsTool,
    handoffToReceptionistTool,
];

export function findTool(name: string): Tool | undefined {
    return soxiTools.find((t) => t.name === name);
}

export { resolveClient } from "./clients.tool";
