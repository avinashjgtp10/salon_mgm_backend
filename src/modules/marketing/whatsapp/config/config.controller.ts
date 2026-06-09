import { Request, Response, NextFunction } from 'express'
import { configService } from './config.service'
import { whatsappMetaApi } from '../shared/whatsapp.api'
import { configRepository } from './config.repository'
import pool from '../../../../config/database'  // ← ADD THIS

type AuthRequest = Request & { user?: { userId: string; salonId?: string; role?: string } }

export const configController = {

  async getConfig(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })
      const data = await configService.getConfig(salonId)
      return res.status(200).json(data)
    } catch (e) { return next(e) }
  },

  async saveConfig(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })
      const data = await configService.saveConfig(salonId, req.body)
      return res.status(200).json(data)
    } catch (e) { return next(e) }
  },

  async testConnection(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })
      const data = await configService.testConnection(salonId)
      return res.status(200).json(data)
    } catch (e) { return next(e) }
  },

  async syncLimits(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ error: 'salonId missing from token' })
      const config = await configRepository.findBySalonId(salonId)
      if (!config) return res.status(404).json({ error: 'WhatsApp not configured' })
      const limits = await whatsappMetaApi.fetchPhoneNumberLimits(
        config.phone_number_id,
        config.access_token,
        config.waba_id
      )
      await configRepository.setVerified(
        salonId,
        config.display_phone ?? '',
        limits.quality_rating,
        limits.daily_limit
      )
      const updated = await configService.getConfig(salonId)
      return res.status(200).json(updated)
    } catch (e) { return next(e) }
  },

  // ── Verify Phone Number ID + WABA ID ──────────────────────────────────────
  async verifyPhone(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { phone_number_id, waba_id, access_token } = req.body
      if (!phone_number_id || !waba_id || !access_token) {
        return res.status(400).json({ valid: false, error: 'phone_number_id, waba_id and access_token are required' })
      }
      const [phoneResult, wabaResult] = await Promise.all([
        whatsappMetaApi.verifyPhoneNumberId({ phoneNumberId: phone_number_id, accessToken: access_token }),
        whatsappMetaApi.verifyWabaId({ wabaId: waba_id, accessToken: access_token }),
      ])
      if (!phoneResult.valid) {
        return res.status(200).json({ valid: false, error: 'Phone Number ID: ' + phoneResult.error })
      }
      if (!wabaResult.valid) {
        return res.status(200).json({ valid: false, error: 'WABA ID: ' + wabaResult.error })
      }
      return res.status(200).json({
        valid:        true,
        displayPhone: phoneResult.displayPhone,
        verifiedName: phoneResult.verifiedName,
        wabaName:     wabaResult.name,
      })
    } catch (e) { return next(e) }
  },

  // ── Verify App ID + App Secret ────────────────────────────────────────────
  async verifyApp(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { app_id, app_secret } = req.body
      if (!app_id || !app_secret) {
        return res.status(400).json({ valid: false, error: 'app_id and app_secret are required' })
      }
      const result = await whatsappMetaApi.verifyAppCredentials({ appId: app_id, appSecret: app_secret })
      return res.status(200).json(result)
    } catch (e) { return next(e) }
  },

  // ── Verify all credentials (final onboarding step) ────────────────────────
  async verifyAll(req: AuthRequest, res: Response, next: NextFunction) {
    try {
      const { phone_number_id, waba_id, app_id, app_secret, access_token, webhook_verify_token } = req.body
      const salonId = req.user?.salonId
      if (!salonId) return res.status(400).json({ valid: false, error: 'salonId missing from token' })

      const results: { check: string; valid: boolean; info?: string; error?: string }[] = []

      // 1. Verify App credentials
      const appResult = await whatsappMetaApi.verifyAppCredentials({ appId: app_id, appSecret: app_secret })
      results.push({
        check: 'App Credentials',
        valid: appResult.valid,
        info:  appResult.valid ? 'App: ' + appResult.appName : undefined,
        error: appResult.error,
      })
      if (!appResult.valid) return res.status(200).json({ valid: false, results })

      // 2. Verify Access Token
      const tokenResult = await whatsappMetaApi.verifyAccessToken({ accessToken: access_token })
      results.push({
        check: 'Access Token',
        valid: tokenResult.valid,
        info:  tokenResult.valid ? 'Permissions OK' : undefined,
        error: tokenResult.error,
      })
      if (!tokenResult.valid) return res.status(200).json({ valid: false, results })

      // 3. Verify Phone Number ID + WABA ID
      const [phoneResult, wabaResult] = await Promise.all([
        whatsappMetaApi.verifyPhoneNumberId({ phoneNumberId: phone_number_id, accessToken: access_token }),
        whatsappMetaApi.verifyWabaId({ wabaId: waba_id, accessToken: access_token }),
      ])
      results.push({
        check: 'Phone Number ID',
        valid: phoneResult.valid,
        info:  phoneResult.valid ? 'Found: ' + phoneResult.displayPhone : undefined,
        error: phoneResult.error,
      })
      if (!phoneResult.valid) return res.status(200).json({ valid: false, results })

      results.push({
        check: 'WhatsApp Business Account',
        valid: wabaResult.valid,
        info:  wabaResult.valid ? 'WABA: ' + wabaResult.name : undefined,
        error: wabaResult.error,
      })
      if (!wabaResult.valid) return res.status(200).json({ valid: false, results })

      // 4. Check phone_number_id not already used by another salon
      const { rows: phoneTaken } = await pool.query(
        `SELECT salon_id FROM whatsapp_configs
         WHERE phone_number_id = $1 AND salon_id != $2`,
        [phone_number_id, salonId]
      )
      if (phoneTaken[0]) {
        results.push({
          check: 'Phone Number ID',
          valid: false,
          error: 'This Phone Number ID is already registered to another account. Each salon must have their own WhatsApp number.',
        })
        return res.status(200).json({ valid: false, results })
      }

      // 5. Check webhook verify token uniqueness
      const tokenTaken = await configRepository.isVerifyTokenTaken(webhook_verify_token, salonId)
      results.push({
        check: 'Webhook Verify Token',
        valid: !tokenTaken,
        info:  !tokenTaken ? 'Token is unique' : undefined,
        error: tokenTaken ? 'This verify token is already used by another account. Choose a different one.' : undefined,
      })
      if (tokenTaken) return res.status(200).json({ valid: false, results })

      return res.status(200).json({
        valid:        true,
        results,
        displayPhone: phoneResult.displayPhone,
        verifiedName: phoneResult.verifiedName,
        wabaName:     wabaResult.name,
      })
    } catch (e) { return next(e) }
  },
}