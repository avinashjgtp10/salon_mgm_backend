import logger from '../../config/logger';
import { packageTemplatesRepository } from '../package-templates/package-templates.repository';
import { packagesRepository } from '../packages/packages.repository';
import { servicesRepository } from '../services/services.repository';
import { clientPackagesService } from '../client-packages/client-packages.service';

export interface PackageAutoCreateItem {
  package_id?: string | null;
  name?: string | null;
  price?: number | string | null;
  quantity?: number | string | null;
  staff_id?: string | null;
  never_expires?: boolean;
  expiry_date?: string | null;
  services?: Array<{
    serviceId?: string | null;
    serviceName: string;
    totalSessions?: number;
    price?: number;
    schedule?: { scheduledAt: string; staffId?: string } | null;
  }> | null;
}

export interface PackageAutoCreateBillContext {
  salonId: string;
  clientId?: string | null;
  appointmentId?: string;
  gstPercent?: number | null;
  saleId?: string;
  staffId?: string;
  requesterUserId?: string;
  /** Share of the bill collected so far (0..1) — see autoCreateFromPayment. */
  paidFraction: number;
  isFullyPaid: boolean;
}

// Shared by payments.service.ts (initial checkout) and appointments.service.ts
// (editing an already-paid/partial appointment to add/change a package) — both
// need "resolve this package_items entry against its template/catalog, then
// create/settle its client_packages row" with identical logic, so a package
// added either way shows up on the Package Sale report and is redeemable the
// same way. Extracted from payments.service.ts's original inline block rather
// than duplicated, since the two call sites drifting apart is exactly the kind
// of gap that made packages added via an appointment edit invisible to that
// report in the first place.
export async function autoCreatePackagesForBill(
  packageItemsSrc: Array<PackageAutoCreateItem>,
  ctx: PackageAutoCreateBillContext,
): Promise<void> {
  if (!ctx.clientId || packageItemsSrc.length === 0) return;

  const packageCreations: Array<Promise<void>> = [];
  for (const item of packageItemsSrc) {
    packageCreations.push((async () => {
      try {
        // Prefer a Package Template (has a real per-service session
        // breakdown) — fall back to a plain Catalog package (services list
        // only, no session counts), crediting 1 session per included service
        // since that's what was actually billed.
        let services: Array<{ serviceId?: string; serviceName: string; totalSessions: number; price: number; schedule?: { scheduledAt: string; staffId?: string } }> = [];
        let basePrice = Number(item.price ?? 0) * Number(item.quantity ?? 1);
        let discount = 0;
        // Package Templates carry their own precise gst_percentage (set
        // below when one resolves). A plain Catalog package has no tax rate
        // of its own at all — the bill's actual GST on this line was
        // computed client-side from Tax Mapping rules and folded into the
        // appointment total, never broken back out per item. Falling back to
        // the appointment's own blended rate is the same convention
        // reports.repository.ts's unbilled-appointment CTE already uses for
        // the identical "closest rate we actually have" situation, rather
        // than silently leaving this package's own record at 0 GST.
        let gstPercentage = ctx.gstPercent ?? 0;
        let expiryDate = "2099-12-31";
        // Set only when a real template resolves and defines an
        // aggregate-session cap ("Expires after this many services") —
        // custom/combo packages have no template to carry this from.
        let expireAfterServices: number | null = null;
        // Denormalized onto client_packages at sale time, same reasoning as
        // client_memberships.description — resolved from whichever of
        // template/combo actually matches below, so it's declared here and
        // filled in by either branch.
        let description: string | null = null;

        const template = item.package_id
          ? await packageTemplatesRepository.findById(item.package_id, ctx.salonId)
          : null;
        if (template) {
          basePrice = template.basePrice;
          discount = template.discount;
          gstPercentage = template.gstPercentage;
          expireAfterServices = template.expireAfterServices ?? null;
          description = template.description ?? null;
          if (!template.neverExpires && template.expiryDays != null) {
            const d = new Date();
            d.setDate(d.getDate() + template.expiryDays);
            expiryDate = d.toISOString().slice(0, 10);
          }
        } else if (item.never_expires === false && item.expiry_date) {
          // A custom package built on the spot via "+ Sell Package"
          // (ServicesPanel.tsx's PackageRow, isCustom rows) — no template to
          // resolve an expiry from, but the frontend already carries the
          // real date the staff picked in the builder. "2099-12-31" (the
          // default above) already IS this codebase's established
          // never-expires sentinel, so nothing extra is needed when
          // never_expires is true/absent.
          expiryDate = item.expiry_date;
        }

        // Prefer the frontend's own per-service breakdown when present —
        // it's resolved at package-pick time (see PackageRow.tsx) and is the
        // ONLY place a per-service `schedule` (book a future appointment for
        // this service now) can come from; re-deriving from the
        // template/catalog below would silently drop it. Package-level
        // fields (price/discount/GST/expiry) above still come from the
        // template/catalog lookup regardless — the frontend breakdown only
        // carries per-service name/price/sessions.
        if (item.services?.length) {
          services = item.services.map((s) => ({
            serviceId: s.serviceId || undefined,
            serviceName: s.serviceName,
            totalSessions: Number(s.totalSessions) || 1,
            price: Number(s.price) || 0,
            schedule: s.schedule?.scheduledAt ? { scheduledAt: s.schedule.scheduledAt, staffId: s.schedule.staffId } : undefined,
          }));
        } else if (template) {
          services = template.services.map((s) => ({ serviceName: s.serviceName, totalSessions: s.totalSessions, price: s.price }));
        } else {
          const combo = item.package_id
            ? await packagesRepository.findById(item.package_id, ctx.salonId)
            : null;
          if (combo) description = combo.description ?? null;
          if (combo && combo.serviceIds.length > 0) {
            const perServicePrice = parseFloat((basePrice / combo.serviceIds.length).toFixed(2));
            for (const svcId of combo.serviceIds) {
              const svc = await servicesRepository.findById(svcId, ctx.salonId);
              services.push({ serviceId: svcId, serviceName: svc?.name ?? "Service", totalSessions: 1, price: perServicePrice });
            }
            // basePrice here is already what was actually billed (item.price,
            // set by usePackageData.ts/AppointmentModal.tsx's own
            // basePrice-minus-discount calculation) — re-applying the combo's
            // discount on top of it would double-discount this record
            // relative to what the client was actually charged.
          }
        }

        if (services.length === 0) {
          logger.warn(`[package-autocreate] could not resolve package for name="${item.name}" id="${item.package_id}" — skipping client_package auto-create`);
          return;
        }

        await clientPackagesService.autoCreateFromPayment(
          ctx.salonId,
          ctx.clientId!,
          item.name || "Package",
          services,
          basePrice,
          discount,
          gstPercentage,
          expiryDate,
          expireAfterServices,
          description,
          ctx.appointmentId,
          item.staff_id || ctx.staffId || undefined,
          ctx.saleId,
          ctx.requesterUserId,
          ctx.paidFraction,
          ctx.isFullyPaid,
        );
      } catch (err: any) {
        logger.warn('[package-autocreate] package auto-create failed:', err?.message ?? err);
      }
    })());
  }
  // allSettled, not all — each entry already swallows its own errors, and one
  // package failing must never fail the caller's own bill/edit operation.
  await Promise.allSettled(packageCreations);
}
