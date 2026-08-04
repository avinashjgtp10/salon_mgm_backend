import { deploymentAnnouncementsRepository } from "./deployment-announcements.repository";
import { CreateDeploymentAnnouncementBody } from "./deployment-announcements.types";

export const deploymentAnnouncementsService = {
  async create(body: CreateDeploymentAnnouncementBody, createdBy: string | null) {
    return deploymentAnnouncementsRepository.create(body, createdBy);
  },

  async getActive() {
    return deploymentAnnouncementsRepository.getActive();
  },

  async stop(id: string) {
    return deploymentAnnouncementsRepository.stop(id);
  },

  async listRecent() {
    return deploymentAnnouncementsRepository.listRecent();
  },
};
