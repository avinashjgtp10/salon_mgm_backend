import { deploymentAnnouncementsRepository } from "./deployment-announcements.repository";
import { CreateDeploymentAnnouncementBody } from "./deployment-announcements.types";
import { getIO } from "../../config/socket";

export const deploymentAnnouncementsService = {
  async create(body: CreateDeploymentAnnouncementBody, createdBy: string | null) {
    const data = await deploymentAnnouncementsRepository.create(body, createdBy);
    // Broadcast to every connected socket (not a salon room — this is a
    // system-wide notice) so dashboards show the banner the instant a
    // deployment starts, instead of polling /active on a timer.
    try { getIO().emit("deployment_announcement:started", data); } catch { /* socket not initialized (e.g. tests) */ }
    return data;
  },

  async getActive() {
    return deploymentAnnouncementsRepository.getActive();
  },

  async stop(id: string) {
    const data = await deploymentAnnouncementsRepository.stop(id);
    if (data) {
      try { getIO().emit("deployment_announcement:stopped", data); } catch { /* socket not initialized (e.g. tests) */ }
    }
    return data;
  },

  async listRecent() {
    return deploymentAnnouncementsRepository.listRecent();
  },
};
