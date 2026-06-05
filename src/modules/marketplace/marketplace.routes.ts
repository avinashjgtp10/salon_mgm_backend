import { Router } from 'express';
import { authMiddleware } from '../../middleware/auth.middleware';
import { roleMiddleware } from '../../middleware/role.middleware';
import { marketplaceController } from './marketplace.controller';
import {
  validateCreateListing,
  validateUpdateListing,
  validateCreateBooking,
  validateCreateReview,
} from './marketplace.validator';

const router = Router();

// ── Public (no auth) ──────────────────────────────────────────────────────
router.get('/check-email',             marketplaceController.checkEmail);
router.get('/browse/my-bookings',      marketplaceController.getMyBookings);
router.get('/browse/:id/services',     marketplaceController.getServices);
router.get('/browse/:id/staff',        marketplaceController.getStaff);
router.get('/browse/:id/availability', marketplaceController.getAvailability);
router.get('/browse',              marketplaceController.browse);
router.get('/browse/:id',          marketplaceController.getById);
router.get('/browse/:id/reviews',  marketplaceController.getReviews);
router.post('/browse/book',        validateCreateBooking, marketplaceController.createBooking);
router.post('/browse/review',      validateCreateReview,  marketplaceController.createReview);

// ── Partner (salon_owner) ─────────────────────────────────────────────────
router.get('/profile',             authMiddleware, roleMiddleware('salon_owner', 'admin'), marketplaceController.getMyListing);
router.post('/profile',            authMiddleware, roleMiddleware('salon_owner', 'admin'), validateCreateListing, marketplaceController.createListing);
router.put('/profile',             authMiddleware, roleMiddleware('salon_owner', 'admin'), validateUpdateListing, marketplaceController.updateListing);
router.post('/profile/publish',    authMiddleware, roleMiddleware('salon_owner', 'admin'), marketplaceController.publish);
router.post('/profile/unpublish',  authMiddleware, roleMiddleware('salon_owner', 'admin'), marketplaceController.unpublish);
router.post('/profile/images',     authMiddleware, roleMiddleware('salon_owner', 'admin'), marketplaceController.addImage);
router.post('/profile/cover',      authMiddleware, roleMiddleware('salon_owner', 'admin'), marketplaceController.setCoverImage);
router.delete('/profile/images',   authMiddleware, roleMiddleware('salon_owner', 'admin'), marketplaceController.removeImage);
router.get('/profile/bookings',    authMiddleware, roleMiddleware('salon_owner', 'admin'), marketplaceController.getPartnerBookings);

router.get('/wishlist',                authMiddleware, marketplaceController.getWishlist);
router.post('/wishlist/:id',           authMiddleware, marketplaceController.addToWishlist);
router.delete('/wishlist/:id',         authMiddleware, marketplaceController.removeFromWishlist);
router.get('/notifications',           authMiddleware, marketplaceController.getNotifications);
router.post('/notifications/read-all', authMiddleware, marketplaceController.markAllNotificationsRead);
router.patch('/notifications/:id',     authMiddleware, marketplaceController.markNotificationRead);

// ── Admin ─────────────────────────────────────────────────────────────────
router.get('/admin/listings',           authMiddleware, roleMiddleware('admin'), marketplaceController.adminListAll);
router.post('/admin/listings/:id/approve', authMiddleware, roleMiddleware('admin'), marketplaceController.adminApprove);
router.post('/admin/listings/:id/reject',  authMiddleware, roleMiddleware('admin'), marketplaceController.adminReject);
router.get('/admin/bookings',           authMiddleware, roleMiddleware('admin'), marketplaceController.adminListBookings);
router.patch('/admin/bookings/:id',     authMiddleware, roleMiddleware('admin'), marketplaceController.adminUpdateBookingStatus);

export default router;