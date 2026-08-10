export type DesignKind = 'design' | 'template';
export type DesignStatus = 'draft' | 'published' | 'archived';

/**
 * The design document itself is deliberately typed loosely here.
 *
 * The authoritative schema lives with the editor (frontend
 * features/marketing/designer/schema.ts) and is versioned by `schemaVersion`
 * inside the doc. The server stores and returns it verbatim — it does not
 * interpret element shapes — so adding a new element type never requires a
 * backend deploy. The only thing the server enforces is that the doc is an
 * object carrying a schemaVersion it recognises.
 */
export interface DesignDoc {
  schemaVersion: number;
  canvas: { width: number; height: number; [k: string]: unknown };
  elements: unknown[];
  [k: string]: unknown;
}

export type CouponDesign = {
  id: string;
  /** NULL = a SalonOx starter template, visible to every salon, forked on edit. */
  salon_id: string | null;
  name: string;
  kind: DesignKind;
  status: DesignStatus;
  preset: string;
  width_px: number;
  height_px: number;
  doc: DesignDoc;
  thumbnail_url: string | null;
  coupon_id: string | null;
  tags: string[];
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CreateCouponDesignBody = {
  name?: string;
  kind?: DesignKind;
  status?: DesignStatus;
  preset?: string;
  width_px: number;
  height_px: number;
  doc: DesignDoc;
  thumbnail_url?: string | null;
  coupon_id?: string | null;
  tags?: string[];
};

export type UpdateCouponDesignBody = Partial<CreateCouponDesignBody>;

export type ListCouponDesignsQuery = {
  /** 'design' (default) or 'template'. Templates include the global ones. */
  kind?: DesignKind;
  status?: DesignStatus;
  search?: string;
};
