import { AppError } from '../../middleware/error.middleware';
import { marketplaceRepository } from './marketplace.repository';
import {
  MarketplaceListing, MarketplaceBooking, MarketplaceReview,
  CreateListingBody, UpdateListingBody, CreateBookingBody, CreateReviewBody,
} from './marketplace.types';

export const marketplaceService = {

  // ── Partner: manage own listing ───────────────────────────────────────────


  async getListingByUserId(userId: string): Promise<MarketplaceListing | null> {
    return marketplaceRepository.findListingByUserId(userId);
  },

  async ensureSalon(userId: string, businessName: string): Promise<string> {
    return marketplaceRepository.ensureSalonExists(userId, businessName);
  },

  async getMyListing(salonId: string): Promise<MarketplaceListing | null> {
    return marketplaceRepository.findListingBySalonId(salonId);
  },

  async createOrGetListing(salonId: string, body: CreateListingBody): Promise<MarketplaceListing> {
    const existing = await marketplaceRepository.findListingBySalonId(salonId);
    if (existing) throw new AppError(409, 'Listing already exists for this salon', 'CONFLICT');
    return marketplaceRepository.createListing(salonId, body);
  },

  async updateMyListing(salonId: string, patch: UpdateListingBody): Promise<MarketplaceListing> {
    let listing = await marketplaceRepository.findListingBySalonId(salonId);
    if (!listing) listing = await marketplaceRepository.findListingByUserId(salonId);
    if (!listing) throw new AppError(404, 'Listing not found', 'NOT_FOUND');
    // Strip out null/undefined/empty-string values so we never overwrite existing data with blanks
    const cleanPatch = Object.fromEntries(
      Object.entries(patch).filter(([_, v]) => v !== null && v !== undefined && v !== '')
    ) as UpdateListingBody;
    if (Object.keys(cleanPatch).length === 0) return listing;
    return marketplaceRepository.updateListing(listing.id, cleanPatch);
  },

  async publish(salonId: string): Promise<MarketplaceListing> {
    let listing = await marketplaceRepository.findListingBySalonId(salonId);
    if (!listing) listing = await marketplaceRepository.findListingByUserId(salonId);
    if (!listing) throw new AppError(404, 'Listing not found', 'NOT_FOUND');
    if (listing.status !== 'approved')
      throw new AppError(400, 'Listing must be approved before publishing', 'BAD_REQUEST');
    return marketplaceRepository.setPublished(listing.id, true);
  },

  async unpublish(salonId: string): Promise<MarketplaceListing> {
    const listing = await marketplaceRepository.findListingBySalonId(salonId);
    if (!listing) throw new AppError(404, 'Listing not found', 'NOT_FOUND');
    return marketplaceRepository.setPublished(listing.id, false);
  },

  async addImage(salonId: string, imageUrl: string): Promise<MarketplaceListing> {
    const listing = await marketplaceRepository.findListingBySalonId(salonId);
    if (!listing) throw new AppError(404, 'Listing not found', 'NOT_FOUND');
    return marketplaceRepository.addImage(listing.id, imageUrl);
  },

  async setCoverImage(salonId: string, imageUrl: string): Promise<MarketplaceListing> {
    const listing = await marketplaceRepository.findListingBySalonId(salonId);
    if (!listing) throw new AppError(404, 'Listing not found', 'NOT_FOUND');
    return marketplaceRepository.setCoverImage(listing.id, imageUrl);
  },

  async removeImage(salonId: string, imageUrl: string): Promise<MarketplaceListing> {
    const listing = await marketplaceRepository.findListingBySalonId(salonId);
    if (!listing) throw new AppError(404, 'Listing not found', 'NOT_FOUND');
    return marketplaceRepository.removeImage(listing.id, imageUrl);
  },

  // ── Admin ─────────────────────────────────────────────────────────────────

  async adminListAll(filters: { status?: string; city?: string }): Promise<MarketplaceListing[]> {
    return marketplaceRepository.listAll(filters);
  },

  async adminApprove(listingId: string): Promise<MarketplaceListing> {
    const listing = await marketplaceRepository.findListingById(listingId);
    if (!listing) throw new AppError(404, 'Listing not found', 'NOT_FOUND');
    return marketplaceRepository.updateStatus(listingId, 'approved');
  },

  async adminReject(listingId: string): Promise<MarketplaceListing> {
    const listing = await marketplaceRepository.findListingById(listingId);
    if (!listing) throw new AppError(404, 'Listing not found', 'NOT_FOUND');
    return marketplaceRepository.updateStatus(listingId, 'rejected');
  },

  async adminListBookings(filters: { status?: string }): Promise<MarketplaceBooking[]> {
    return marketplaceRepository.listAllBookings(filters);
  },

  async adminUpdateBookingStatus(bookingId: string, status: string): Promise<MarketplaceBooking> {
    return marketplaceRepository.updateBookingStatus(bookingId, status);
  },

  // ── Public: consumer browse ───────────────────────────────────────────────

  async browse(filters: {
    city?: string; category?: string; search?: string; limit?: number; offset?: number;
  }): Promise<MarketplaceListing[]> {
    return marketplaceRepository.listPublished(filters);
  },

  async getListingById(id: string): Promise<MarketplaceListing> {
    const listing = await marketplaceRepository.findListingById(id);
    if (!listing || !listing.is_published)
      throw new AppError(404, 'Listing not found', 'NOT_FOUND');
    return listing;
  },

  async createBooking(body: CreateBookingBody): Promise<MarketplaceBooking> {
    const listing = await marketplaceRepository.findListingById(body.listing_id);
    if (!listing || !listing.is_published)
      throw new AppError(404, 'Listing not found', 'NOT_FOUND');
    return marketplaceRepository.createBooking(listing.salon_id, body);
  },

  async getBookingsForListing(listingId: string): Promise<MarketplaceBooking[]> {
    return marketplaceRepository.listBookingsByListing(listingId);
  },

  async createReview(body: CreateReviewBody): Promise<MarketplaceReview> {
    const listing = await marketplaceRepository.findListingById(body.listing_id);
    if (!listing) throw new AppError(404, 'Listing not found', 'NOT_FOUND');
    return marketplaceRepository.createReview(body);
  },

  async getReviewsForListing(listingId: string): Promise<MarketplaceReview[]> {
    return marketplaceRepository.listReviewsByListing(listingId);
  },

  async checkEmail(email: string): Promise<{ exists: boolean; role: string | null }> {
    return marketplaceRepository.checkEmailExists(email);
  },

  async getServicesForListing(listingId: string): Promise<any[]> {
    return marketplaceRepository.getServicesByListingId(listingId);
  },

  async getStaffForListing(listingId: string): Promise<any[]> {
    return marketplaceRepository.getStaffByListingId(listingId);
  },

  async getAvailability(listingId: string, date: string): Promise<string[]> {
    return marketplaceRepository.getBookedSlotsForDate(listingId, date);
  },

  async getMyBookings(customerPhone: string): Promise<MarketplaceBooking[]> {
    return marketplaceRepository.getBookingsByPhone(customerPhone);
  },

  async getWishlist(userId: string): Promise<string[]> {
    return marketplaceRepository.getWishlist(userId);
  },

  async addToWishlist(userId: string, listingId: string): Promise<void> {
    return marketplaceRepository.addToWishlist(userId, listingId);
  },

  async removeFromWishlist(userId: string, listingId: string): Promise<void> {
    return marketplaceRepository.removeFromWishlist(userId, listingId);
  },

  async getNotifications(userId: string): Promise<any[]> {
    return marketplaceRepository.getNotifications(userId);
  },

  async markNotificationRead(id: string, userId: string): Promise<void> {
    return marketplaceRepository.markNotificationRead(id, userId);
  },

  async markAllNotificationsRead(userId: string): Promise<void> {
    return marketplaceRepository.markAllNotificationsRead(userId);
  },

};