import { Router } from "express";
import express from "express";
import { authMiddleware } from "../../middleware/auth.middleware";
import { roleMiddleware } from "../../middleware/role.middleware";
import { deviceController } from "./device.controller";
import {
    admsHandshake,
    admsDataPush,
    admsGetRequest,
    admsDeviceCmd,
} from "./adms.controller";

// ── REST API (frontend) ───────────────────────────────────────────────────────

export const deviceApiRouter = Router();
const ownerAdmin = roleMiddleware("salon_owner", "admin");

deviceApiRouter.get("/",                               authMiddleware, ownerAdmin, deviceController.list);
deviceApiRouter.post("/",                              authMiddleware, ownerAdmin, deviceController.add);
deviceApiRouter.get("/pending",                        authMiddleware, ownerAdmin, deviceController.getPending);
deviceApiRouter.post("/pending/:sn/connect",           authMiddleware, ownerAdmin, deviceController.connectPending);
deviceApiRouter.patch("/:id",                          authMiddleware, ownerAdmin, deviceController.update);
deviceApiRouter.delete("/:id",                         authMiddleware, ownerAdmin, deviceController.remove);
deviceApiRouter.get("/:id/mappings",                   authMiddleware, ownerAdmin, deviceController.getMappings);
deviceApiRouter.post("/:id/mappings",                  authMiddleware, ownerAdmin, deviceController.addMapping);
deviceApiRouter.delete("/:id/mappings/:mappingId",     authMiddleware, ownerAdmin, deviceController.removeMapping);

// ── ADMS Protocol (biometric machines) ───────────────────────────────────────
// Mounted at /iclock — no JWT, machine identified by SN query param.
// Needs raw text body parsing for attendance data.

export const admsRouter = Router();

// Accept any Content-Type (including none) — ZKTeco models vary
admsRouter.use(express.text({ type: () => true, limit: "2mb" }));

admsRouter.get( "/cdata",     admsHandshake);
admsRouter.post("/cdata",     admsDataPush);
admsRouter.get( "/getrequest",admsGetRequest);
admsRouter.post("/devicecmd", admsDeviceCmd);
