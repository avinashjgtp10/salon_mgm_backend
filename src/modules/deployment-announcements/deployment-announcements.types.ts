export type DeploymentAnnouncementStatus = "active" | "stopped";

export interface DeploymentAnnouncement {
  id: string;
  message: string;
  start_time: string;
  end_time: string;
  status: DeploymentAnnouncementStatus;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateDeploymentAnnouncementBody {
  message: string;
  start_time?: string; // defaults to now when omitted
  end_time: string;
}
