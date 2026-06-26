import { Request, Response } from "express";
import { deviceService } from "./device.service";
import logger from "../../config/logger";

// ── ADMS Protocol Controller ───────────────────────────────────────────────────
// Handles ZKTeco / ESSL / Realtime / Biomax biometric machine push protocol.
// Machines are configured with server URL pointing to this backend.
// No JWT auth — devices identify themselves by serial number (SN query param).

function getSN(req: Request): string {
    return String(req.query.SN || req.query.sn || "").trim().toUpperCase();
}

function getIP(req: Request): string {
    return String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "");
}

// ── Handshake + keepalive ──────────────────────────────────────────────────────
// Machine sends: GET /iclock/cdata?SN=xxx&options=all&pushver=2.x
// Also sent periodically as a heartbeat.

export async function admsHandshake(req: Request, res: Response) {
    const sn = getSN(req);
    const ip = getIP(req);

    logger.info("ADMS: handshake", { sn, ip });

    if (sn) {
        deviceService.handleHeartbeat(sn, ip).catch((err) => {
            logger.error("ADMS: handleHeartbeat failed", { sn, err });
        });
    }

    // Standard ADMS handshake response — machine uses these settings
    res.type("text/plain").send(
        [
            "OK",
            "ATTLOGStamp=9999",
            "OPERLOGStamp=9999",
            "ATTPHOTOStamp=9999",
            "ErrorDelay=30",
            "Delay=20",                   // poll interval in seconds
            "TransTimes=00:00;14:05",
            "TransInterval=1",
            "TransFlag=TransData AttLog",
            "TimeZone=5.5",               // IST
            "Realtime=1",
            "Encrypt=None",
        ].join("\r\n")
    );
}

// ── Attendance data push ───────────────────────────────────────────────────────
// Machine sends: POST /iclock/cdata?SN=xxx&table=ATTLOG&Stamp=9999
// Body (text/plain):
//   PIN=1\tTime=2026-06-19 09:15:00\tStatus=0\tVerify=1\tWorkCode=0\tReserved=\n

export async function admsDataPush(req: Request, res: Response) {
    const sn    = getSN(req);
    const table = String(req.query.table || "").toUpperCase();
    const ip    = getIP(req);

    if (!sn) {
        res.type("text/plain").status(400).send("ERROR: missing SN");
        return;
    }

    // Only process attendance logs — ignore OPERLOG, ATTPHOTO, etc.
    if (table !== "ATTLOG") {
        res.type("text/plain").send("OK: 0");
        return;
    }

    const body = typeof req.body === "string" ? req.body : "";
    logger.info("ADMS: data push", { sn, table, lines: body.split("\n").length });

    try {
        const count = await deviceService.processAttLog(sn, body, ip);
        res.type("text/plain").send(`OK: ${count}`);
    } catch (err) {
        logger.error("ADMS: processAttLog error", { err });
        res.type("text/plain").send("OK: 0");
    }
}

// ── Command polling ────────────────────────────────────────────────────────────
// Machine sends: GET /iclock/getrequest?SN=xxx
// We reply with OK (no pending commands for now).

export function admsGetRequest(req: Request, res: Response) {
    const sn = getSN(req);
    logger.debug("ADMS: getrequest", { sn });
    res.type("text/plain").send("OK");
}

// ── Command acknowledgment ─────────────────────────────────────────────────────
// Machine sends: POST /iclock/devicecmd?SN=xxx after executing a command.

export function admsDeviceCmd(_req: Request, res: Response) {
    res.type("text/plain").send("OK");
}
