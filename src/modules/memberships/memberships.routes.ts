// src/modules/memberships/memberships.routes.ts
import { Router } from "express";
import { membershipsController } from "./memberships.controller";
import { validateCreateMembership, validateUpdateMembership, validateMembershipsListQuery } from "./memberships.validator";

const router = Router();

router.get("/", validateMembershipsListQuery, membershipsController.list);
router.post("/", validateCreateMembership, membershipsController.create);
router.get("/:id", membershipsController.getById);
router.patch("/:id", validateUpdateMembership, membershipsController.update);
router.delete("/:id", membershipsController.delete);

export default router;
