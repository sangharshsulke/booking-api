'use strict';

// services/slotService.js
//
// Central slot-availability engine.
// Called by controllers — ZERO SQL inside routes/controllers.
//
// Covers every blocking condition:
//   1. Online bookings  (confirmed / pending / completed)
//   2. Offline bookings (walk-in)  — user_id == vendor_id in bookings table
//   3. Vendor break time
//   4. Weekly holiday (shop.weekly_holiday day-of-week match)
//   5. Full-day block  (vendor_holidays table)
//   6. Partial-day block (vendor_early_closures table)
//   7. Service duration blocks multiple consecutive slots

const db = require('../config/database');

const SLOT_INTERVAL = 30; // minutes

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** "HH:MM" or "HH:MM:SS"  →  total minutes since midnight */
function toMins(t) {
    if (!t) return 0;
    const parts = String(t).split(':').map(Number);
    return parts[0] * 60 + parts[1]; // ignore seconds
}

/** total minutes since midnight  →  "HH:MM" */
function fromMins(m) {
    const h  = Math.floor(m / 60).toString().padStart(2, '0');
    const mn = (m % 60).toString().padStart(2, '0');
    return `${h}:${mn}`;
}

/**
 * Given a booking start time and its total duration, return every
 * 30-min slot key that this booking occupies.
 *
 *   start="10:00", duration=90  →  ["10:00", "10:30", "11:00"]
 */
function occupiedSlotKeys(startTime, durationMinutes) {
    const keys = [];
    let cur = toMins(String(startTime).substring(0, 5));
    const end = cur + Math.max(durationMinutes, SLOT_INTERVAL);
    while (cur < end) {
        keys.push(fromMins(cur));
        cur += SLOT_INTERVAL;
    }
    return keys;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * getAvailableSlots(shopId, date)
 *
 * Returns either:
 *   { isClosed: true,  reason, openTime, closeTime, ... }
 *   { isClosed: false, slots: [...], openTime, closeTime, ... }
 *
 * Each slot object:
 *   { time, is_available, available_seats, is_break, reason }
 *
 * reason values: null | "break" | "holiday" | "blocked" | "booked" | "offline"
 */
async function getAvailableSlots(shopId, date) {

    // ── STEP 1: Load shop meta ──────────────────────────────────────────────
    const shopRes = await db.query(
        `SELECT
       vsd.shop_id,
       vsd.user_id          AS vendor_id,
       vsd.open_time,
       vsd.close_time,
       vsd.break_start_time,
       vsd.break_end_time,
       vsd.weekly_holiday,
       vsd.no_of_seats,
       vsd.verification_status
     FROM vendor_shop_details vsd
     WHERE vsd.shop_id = $1
       AND vsd.status  = 'active'`,
        [shopId]
    );

    if (!shopRes.rows.length) {
        return { isClosed: false, slots: [], error: 'Shop not found' };
    }

    const shop     = shopRes.rows[0];
    const vendorId = shop.vendor_id;

    // ── STEP 2: Weekly holiday check ────────────────────────────────────────
    const bookingDate = new Date(date + 'T00:00:00');
    const dayOfWeek   = bookingDate.toLocaleDateString('en-US', { weekday: 'long' });

    if (
        shop.weekly_holiday &&
        shop.weekly_holiday.toLowerCase() === dayOfWeek.toLowerCase()
    ) {
        return {
            isClosed:  true,
            date,
            openTime:  shop.open_time,
            closeTime: shop.close_time,
            reason:    'weekly_holiday',
            slots:     [],
        };
    }

    // ── STEP 3: Full-day block check (vendor_holidays table) ────────────────
    const holidayRes = await db.query(
        `SELECT holiday_id FROM vendor_holidays
     WHERE vendor_id   = $1
       AND holiday_date = $2
       AND status      = 'active'`,
        [vendorId, date]
    );

    if (holidayRes.rows.length > 0) {
        return {
            isClosed:  true,
            date,
            openTime:  shop.open_time,
            closeTime: shop.close_time,
            reason:    'holiday',
            slots:     [],
        };
    }

    // ── STEP 4: Partial-day blocks (vendor_early_closures table) ────────────
    const closureRes = await db.query(
        `SELECT reason, early_close_time
     FROM vendor_early_closures
     WHERE vendor_id   = $1
       AND closure_date = $2
       AND status      = 'active'`,
        [vendorId, date]
    );

    // Parse block ranges from reason field: "Block: HH:MM - HH:MM"
    const blockedRanges = closureRes.rows
        .map(r => {
            const match = (r.reason || '').match(
                /Block:\s*(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/
            );
            if (match) return { startMins: toMins(match[1]), endMins: toMins(match[2]) };
            return null;
        })
        .filter(Boolean);

    // ── STEP 5: Load all bookings for this vendor+date ───────────────────────
    //    Includes online AND offline (offline = user_id == vendor_id)
    const bookingsRes = await db.query(
        `SELECT
       b.booking_id,
       b.booking_time,
       COALESCE(
         (SELECT SUM(bs.duration_minutes)
          FROM booking_services bs
          WHERE bs.booking_id = b.booking_id
            AND bs.status = 'active'),
         30
       )::int AS total_duration,
       (b.user_id = b.vendor_id) AS is_offline
     FROM bookings b
     WHERE b.vendor_id    = $1
       AND b.booking_date  = $2
       AND b.booking_status IN ('confirmed', 'pending', 'completed')
       AND b.status        = 'active'`,
        [vendorId, date]
    );

    // ── STEP 6: Build occupied-count map  { "HH:MM" → count } ───────────────
    const occupiedCounts = {}; // how many bookings occupy each 30-min key
    const offlineSlots   = new Set();

    for (const booking of bookingsRes.rows) {
        const timeStr  = String(booking.booking_time).substring(0, 5);
        const duration = Number(booking.total_duration) || SLOT_INTERVAL;
        const keys     = occupiedSlotKeys(timeStr, duration);

        for (const key of keys) {
            occupiedCounts[key] = (occupiedCounts[key] || 0) + 1;
            if (booking.is_offline) offlineSlots.add(key);
        }
    }

    // ── STEP 7: Generate slot grid ───────────────────────────────────────────
    const openMins  = toMins(shop.open_time);
    const closeMins = toMins(shop.close_time);
    const brkStart  = shop.break_start_time ? toMins(shop.break_start_time) : null;
    const brkEnd    = shop.break_end_time   ? toMins(shop.break_end_time)   : null;
    const seats     = Number(shop.no_of_seats) || 1;

    const slots = [];

    for (let cur = openMins; cur < closeMins; cur += SLOT_INTERVAL) {
        const key = fromMins(cur);

        // ── Break time ───────────────────────────────────────────────────────
        const isBreak =
            brkStart !== null && brkEnd !== null &&
            cur >= brkStart && cur < brkEnd;

        if (isBreak) {
            slots.push({
                time:            key,
                is_available:    false,
                available_seats: 0,
                is_break:        true,
                reason:          'break',
            });
            continue;
        }

        // ── Partial-day block ────────────────────────────────────────────────
        const isBlocked = blockedRanges.some(
            r => cur >= r.startMins && cur < r.endMins
        );

        if (isBlocked) {
            slots.push({
                time:            key,
                is_available:    false,
                available_seats: 0,
                is_break:        false,
                reason:          'blocked',
            });
            continue;
        }

        // ── Booking occupancy ────────────────────────────────────────────────
        const bookedCount    = occupiedCounts[key] || 0;
        const availableSeats = Math.max(0, seats - bookedCount);
        const isOffline      = offlineSlots.has(key);

        let reason = null;
        if (availableSeats === 0) {
            reason = isOffline ? 'offline' : 'booked';
        }

        slots.push({
            time:            key,
            is_available:    availableSeats > 0,
            available_seats: availableSeats,
            is_break:        false,
            reason,
        });
    }

    return {
        isClosed:       false,
        date,
        openTime:       shop.open_time,
        closeTime:      shop.close_time,
        breakStartTime: shop.break_start_time || null,
        breakEndTime:   shop.break_end_time   || null,
        totalSeats:     seats,
        slots,
    };
}

module.exports = { getAvailableSlots };