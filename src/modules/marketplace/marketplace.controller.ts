import { Request, Response, NextFunction } from 'express';
import { AppError } from '../../middleware/error.middleware';
import { sendSuccess } from '../utils/response.util';
import { marketplaceService } from './marketplace.service';

type AuthRequest = Request & { user?: { userId: string; role?: string; salonId?: string | null } };

export const marketplaceController = {

  // ── Partner routes ────────────────────────────────────────────────────────

  async getMyListing(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { salonId, userId } = req.user ?? {};
      if (!userId) throw new AppError(401, 'Unauthorized', 'UNAUTHORIZED');
      const listing = salonId
        ? await marketplaceService.getMyListing(salonId)
        : await marketplaceService.getListingByUserId(userId);
      return sendSuccess(res, 200, listing, 'Listing fetched');
    } catch (err) { return next(err); }
  },

  async createListing(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { salonId, userId } = req.user ?? {};
      if (!userId) throw new AppError(401, 'Unauthorized', 'UNAUTHORIZED');
      const resolvedId = salonId ?? await marketplaceService.ensureSalon(userId, req.body.display_name);
      const listing = await marketplaceService.createOrGetListing(resolvedId, req.body);
      return sendSuccess(res, 201, listing, 'Listing created');
    } catch (err) { return next(err); }
  },

  async updateListing(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { salonId, userId } = req.user ?? {};
      if (!userId) throw new AppError(401, 'Unauthorized', 'UNAUTHORIZED');
      // Use salonId if available, otherwise userId — service will try both
      const resolvedId = salonId ?? userId;
      const listing = await marketplaceService.updateMyListing(resolvedId, req.body);
      return sendSuccess(res, 200, listing, 'Listing updated');
    } catch (err) { return next(err); }
  },

  async publish(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { salonId, userId } = req.user ?? {};
      if (!userId) throw new AppError(401, 'Unauthorized', 'UNAUTHORIZED');
      const resolvedId = salonId ?? userId;
      const listing = await marketplaceService.publish(resolvedId);
      return sendSuccess(res, 200, listing, 'Listing published');
    } catch (err) { return next(err); }
  },

  async unpublish(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId;
      if (!salonId) throw new AppError(403, 'Salon context required', 'NO_SALON_CONTEXT');
      const listing = await marketplaceService.unpublish(salonId);
      return sendSuccess(res, 200, listing, 'Listing unpublished');
    } catch (err) { return next(err); }
  },

  async addImage(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId;
      if (!salonId) throw new AppError(403, 'Salon context required', 'NO_SALON_CONTEXT');
      const { image_url } = req.body;
      if (!image_url) throw new AppError(400, 'image_url is required', 'VALIDATION_ERROR');
      const listing = await marketplaceService.addImage(salonId, image_url);
      return sendSuccess(res, 200, listing, 'Image added');
    } catch (err) { return next(err); }
  },

  async setCoverImage(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId;
      if (!salonId) throw new AppError(403, 'Salon context required', 'NO_SALON_CONTEXT');
      const { image_url } = req.body;
      if (!image_url) throw new AppError(400, 'image_url is required', 'VALIDATION_ERROR');
      const listing = await marketplaceService.setCoverImage(salonId, image_url);
      return sendSuccess(res, 200, listing, 'Cover image set');
    } catch (err) { return next(err); }
  },

  async removeImage(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId;
      if (!salonId) throw new AppError(403, 'Salon context required', 'NO_SALON_CONTEXT');
      const { image_url } = req.body;
      if (!image_url) throw new AppError(400, 'image_url is required', 'VALIDATION_ERROR');
      const listing = await marketplaceService.removeImage(salonId, image_url);
      return sendSuccess(res, 200, listing, 'Image removed');
    } catch (err) { return next(err); }
  },

  async getMyBookings(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId;
      if (!salonId) throw new AppError(403, 'Salon context required', 'NO_SALON_CONTEXT');
      const listing = await marketplaceService.getMyListing(salonId);
      if (!listing) return sendSuccess(res, 200, [], 'No listing found');
      const bookings = await marketplaceService.getBookingsForListing(listing.id);
      return sendSuccess(res, 200, bookings, 'Bookings fetched');
    } catch (err) { return next(err); }
  },

  // ── Admin routes ──────────────────────────────────────────────────────────

  async adminListAll(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const status = String(req.query.status || '').trim() || undefined;
      const city   = String(req.query.city   || '').trim() || undefined;
      const listings = await marketplaceService.adminListAll({ status, city });
      return sendSuccess(res, 200, listings, 'All listings fetched');
    } catch (err) { return next(err); }
  },

  async adminApprove(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id || '').trim();
      if (!id) throw new AppError(400, 'id is required', 'VALIDATION_ERROR');
      const listing = await marketplaceService.adminApprove(id);
      return sendSuccess(res, 200, listing, 'Listing approved');
    } catch (err) { return next(err); }
  },

  async adminReject(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id || '').trim();
      if (!id) throw new AppError(400, 'id is required', 'VALIDATION_ERROR');
      const listing = await marketplaceService.adminReject(id);
      return sendSuccess(res, 200, listing, 'Listing rejected');
    } catch (err) { return next(err); }
  },

  async adminListBookings(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const status = String(req.query.status || '').trim() || undefined;
      const bookings = await marketplaceService.adminListBookings({ status });
      return sendSuccess(res, 200, bookings, 'All bookings fetched');
    } catch (err) { return next(err); }
  },

  async adminUpdateBookingStatus(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id || '').trim();
      const { status } = req.body;
      if (!id || !status) throw new AppError(400, 'id and status required', 'VALIDATION_ERROR');
      const booking = await marketplaceService.adminUpdateBookingStatus(id, status);
      return sendSuccess(res, 200, booking, 'Booking status updated');
    } catch (err) { return next(err); }
  },

  // ── Public routes ─────────────────────────────────────────────────────────

  async browse(req: Request, res: Response, next: NextFunction) {
    try {
      const city     = String(req.query.city     || '').trim() || undefined;
      const category = String(req.query.category || '').trim() || undefined;
      const search   = String(req.query.search   || '').trim() || undefined;
      const limit    = Number(req.query.limit)  || 20;
      const offset   = Number(req.query.offset) || 0;
      const listings = await marketplaceService.browse({ city, category, search, limit, offset });
      return sendSuccess(res, 200, listings, 'Listings fetched');
    } catch (err) { return next(err); }
  },

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id || '').trim();
      if (!id) throw new AppError(400, 'id is required', 'VALIDATION_ERROR');
      const listing = await marketplaceService.getListingById(id);
      return sendSuccess(res, 200, listing, 'Listing fetched');
    } catch (err) { return next(err); }
  },

  async createBooking(req: Request, res: Response, next: NextFunction) {
    try {
      const booking = await marketplaceService.createBooking(req.body);
      return sendSuccess(res, 201, booking, 'Booking created');
    } catch (err) { return next(err); }
  },

  async getReviews(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id || '').trim();
      if (!id) throw new AppError(400, 'id is required', 'VALIDATION_ERROR');
      const reviews = await marketplaceService.getReviewsForListing(id);
      return sendSuccess(res, 200, reviews, 'Reviews fetched');
    } catch (err) { return next(err); }
  },

  async createReview(req: Request, res: Response, next: NextFunction) {
    try {
      const review = await marketplaceService.createReview(req.body);
      return sendSuccess(res, 201, review, 'Review submitted');
    } catch (err) { return next(err); }
  },

  // ── Check email ───────────────────────────────────────────────────────────
  async checkEmail(req: Request, res: Response, next: NextFunction) {
    try {
      const email = String(req.query.email || '').trim().toLowerCase();
      if (!email) throw new AppError(400, 'email query param required', 'VALIDATION_ERROR');
      const result = await marketplaceService.checkEmail(email);
      return sendSuccess(res, 200, result, 'Email checked');
    } catch (err) { return next(err); }
  },

  // ── Browse: services, staff, availability, my-bookings ───────────────────
  async getServices(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id).trim();
      const services = await marketplaceService.getServicesForListing(id);
      return sendSuccess(res, 200, services, 'Services fetched');
    } catch (err) { return next(err); }
  },

  async getStaff(req: Request, res: Response, next: NextFunction) {
    try {
      const id = String(req.params.id).trim();
      const staff = await marketplaceService.getStaffForListing(id);
      return sendSuccess(res, 200, staff, 'Staff fetched');
    } catch (err) { return next(err); }
  },

  async getAvailability(req: Request, res: Response, next: NextFunction) {
    try {
      const id   = String(req.params.id).trim();
      const date = String(req.query.date || '').trim();
      const slots = await marketplaceService.getAvailability(id, date);
      return sendSuccess(res, 200, slots, 'Availability fetched');
    } catch (err) { return next(err); }
  },


  // ── Partner: bookings ─────────────────────────────────────────────────────
  async getPartnerBookings(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { salonId, userId } = req.user ?? {};
      if (!userId) throw new AppError(401, 'Unauthorized', 'UNAUTHORIZED');
      const resolvedId = salonId ?? await marketplaceService.ensureSalon(userId, '');
      const listing = await marketplaceService.getMyListing(resolvedId);
      if (!listing) return sendSuccess(res, 200, [], 'No listing found');
      const bookings = await marketplaceService.getBookingsForListing(listing.id);
      return sendSuccess(res, 200, bookings, 'Bookings fetched');
    } catch (err) { return next(err); }
  },

  // ── Wishlist ──────────────────────────────────────────────────────────────
  async getWishlist(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, 'Unauthorized', 'UNAUTHORIZED');
      const list = await marketplaceService.getWishlist(userId);
      return sendSuccess(res, 200, list, 'Wishlist fetched');
    } catch (err) { return next(err); }
  },

  async addToWishlist(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId    = req.user?.userId;
      const listingId = String(req.params.id);
      if (!userId) throw new AppError(401, 'Unauthorized', 'UNAUTHORIZED');
      await marketplaceService.addToWishlist(userId, listingId);
      return sendSuccess(res, 200, { listing_id: listingId }, 'Added to wishlist');
    } catch (err) { return next(err); }
  },

  async removeFromWishlist(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId    = req.user?.userId;
      const listingId = String(req.params.id);
      if (!userId) throw new AppError(401, 'Unauthorized', 'UNAUTHORIZED');
      await marketplaceService.removeFromWishlist(userId, listingId);
      return sendSuccess(res, 200, { listing_id: listingId }, 'Removed from wishlist');
    } catch (err) { return next(err); }
  },

  // ── Notifications ─────────────────────────────────────────────────────────
  async getNotifications(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, 'Unauthorized', 'UNAUTHORIZED');
      const notifs = await marketplaceService.getNotifications(userId);
      return sendSuccess(res, 200, notifs, 'Notifications fetched');
    } catch (err) { return next(err); }
  },

  async markNotificationRead(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.userId;
      const id     = String(req.params.id);
      if (!userId) throw new AppError(401, 'Unauthorized', 'UNAUTHORIZED');
      await marketplaceService.markNotificationRead(id, userId);
      return sendSuccess(res, 200, null, 'Marked as read');
    } catch (err) { return next(err); }
  },

  async markAllNotificationsRead(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const userId = req.user?.userId;
      if (!userId) throw new AppError(401, 'Unauthorized', 'UNAUTHORIZED');
      await marketplaceService.markAllNotificationsRead(userId);
      return sendSuccess(res, 200, null, 'All marked as read');
    } catch (err) { return next(err); }
  },

};