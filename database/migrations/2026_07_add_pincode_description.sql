-- Migration: add pincode and shop_description to vendor_shop_details
-- Run this against the existing production database once.
-- Bug: shop description / pincode entered during vendor onboarding were
-- never persisted because these columns did not exist on the table.

ALTER TABLE public.vendor_shop_details
  ADD COLUMN IF NOT EXISTS pincode character varying(10),
  ADD COLUMN IF NOT EXISTS shop_description text;
