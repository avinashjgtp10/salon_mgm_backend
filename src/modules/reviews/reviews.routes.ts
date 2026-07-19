import { Router } from "express"
import { authMiddleware } from "../../middleware/auth.middleware"
import { roleMiddleware } from "../../middleware/role.middleware"
import { reviewsController } from "./reviews.controller"

const router = Router()

router.get("/", authMiddleware, roleMiddleware("salon_owner", "admin"), reviewsController.list)
router.get("/stats", authMiddleware, roleMiddleware("salon_owner", "admin"), reviewsController.stats)

export default router
