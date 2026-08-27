-- =============================================================================
-- One-off backfill: qmi.nter_now (NterNow self-tour "Enter Now" links).
--
-- Source: legacy Homefiniti site (esperanzahomes.com) property pages carry the
-- NterNow CTA in server-rendered HTML. All 154 /new-homes/ property pages were
-- scraped; 17 unique self-tour links found. Each NterNow property_id was then
-- VERIFIED against the authoritative NterNow API
-- (https://mobile.api.nternow.com/properties/{id} -> address_1) and matched to
-- the QMI by real street address. The one legacy collision (id 45770 appearing
-- on two pages) resolved via the API to 6600 Anaqua Loop; the stray Aqualina
-- 7023 Cypress Springs reference was a legacy copy-paste error and is excluded.
--
-- All 17 targets are currently published QMIs. Field is admin-owned (nothing
-- syncs it) so this is the only writer. Idempotent: re-running is a no-op.
--
-- Run:
--   wrangler d1 execute esperanza --remote --file=packages/db/backfills/0015_qmi_nter_now.sql
-- Paired with the framer-push QMI-mapper change (adds nter_now emission) + a
-- POST /schema (create the Framer QMI nter_now field) + POST /backfill?keys=qmi.
-- =============================================================================

UPDATE qmi SET nter_now = 'https://www.webflow.nternow.com/EsperanzaHomes/property/50928', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id = 'recu8qkWnYO4idCeG';  -- 14005 Sugarberry Ln (Anaqua at Tres Lagos) [NterNow 50928]
UPDATE qmi SET nter_now = 'https://www.webflow.nternow.com/EsperanzaHomes/property/43111', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id = 'recyn6bR6FOtPv2K8';  -- 6529 Anaqua Loop (Anaqua at Tres Lagos) [NterNow 43111]
UPDATE qmi SET nter_now = 'https://www.webflow.nternow.com/EsperanzaHomes/property/45770', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id = 'recklT5ciadpFVmxG';  -- 6600 Anaqua Loop (Anaqua at Tres Lagos) [NterNow 45770]
UPDATE qmi SET nter_now = 'https://www.webflow.nternow.com/EsperanzaHomes/property/39713', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id = 'rec7vx5Pvw8899nqY';  -- 14918 Aqualina Way (Aqualina at Tres Lagos) [NterNow 39713]
UPDATE qmi SET nter_now = 'https://www.webflow.nternow.com/EsperanzaHomes/property/58086', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id = 'recsstY8B7VITXWXG';  -- 14920 Aqualina Way (Aqualina at Tres Lagos) [NterNow 58086]
UPDATE qmi SET nter_now = 'https://www.webflow.nternow.com/EsperanzaHomes/property/52767', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id = 'recNOum9HDdHcBveA';  -- 2615 N. 40th St. (Harvest Coves) [NterNow 52767]
UPDATE qmi SET nter_now = 'https://www.webflow.nternow.com/EsperanzaHomes/property/55009', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id = 'recJoNqoXeWEo0rwc';  -- 15509 Sereno St (Las Brisas at Tres Lagos) [NterNow 55009]
UPDATE qmi SET nter_now = 'https://www.webflow.nternow.com/EsperanzaHomes/property/49607', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id = 'recEM3Si7HUBhNckO';  -- 1045 W. Star Flower St. (Rogers Coves) [NterNow 49607]
UPDATE qmi SET nter_now = 'https://www.webflow.nternow.com/EsperanzaHomes/property/53778', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id = 'recgoFT2Go1GW4bLY';  -- 1050 W. Star Flower St. (Rogers Coves) [NterNow 53778]
UPDATE qmi SET nter_now = 'https://www.webflow.nternow.com/EsperanzaHomes/property/57014', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id = 'recdvSIHtfXn1GoBm';  -- 912 W. Star Flower St. (Rogers Coves) [NterNow 57014]
UPDATE qmi SET nter_now = 'https://www.webflow.nternow.com/EsperanzaHomes/property/64220', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id = 'rec26rpvYslCBYCI1';  -- 1728 E Marquise St (Sapphire at La Sienna) [NterNow 64220]
UPDATE qmi SET nter_now = 'https://www.webflow.nternow.com/EsperanzaHomes/property/42566', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id = 'rec4avhvVZLHNMcM1';  -- 900 S. Templo Dorado (Sendero at Bentsen Palm) [NterNow 42566]
UPDATE qmi SET nter_now = 'https://www.webflow.nternow.com/EsperanzaHomes/property/42567', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id = 'recrOaeP6EkHlBSRk';  -- 919 Lost Mine Trail (Sendero at Bentsen Palm) [NterNow 42567]
UPDATE qmi SET nter_now = 'https://www.webflow.nternow.com/EsperanzaHomes/property/54353', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id = 'recQlcNC2Nprf5JxB';  -- 1420 E Silos Ave (Silos at La Sienna) [NterNow 54353]
UPDATE qmi SET nter_now = 'https://www.webflow.nternow.com/EsperanzaHomes/property/50036', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id = 'recdCimRoPhQuUBqz';  -- 1925 S. Lake Texoma St (Stewart Coves) [NterNow 50036]
UPDATE qmi SET nter_now = 'https://www.webflow.nternow.com/EsperanzaHomes/property/58135', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id = 'rec6MovsGuvkr7I9v';  -- 318 San Antonio South Lp (Texas Heights) [NterNow 58135]
UPDATE qmi SET nter_now = 'https://www.webflow.nternow.com/EsperanzaHomes/property/49977', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id = 'recSlN9lewz6Kh4k3';  -- 1304 Zurich Avenue (Villas On Freddy) [NterNow 49977]
