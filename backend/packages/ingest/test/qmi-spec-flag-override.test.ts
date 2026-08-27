// =============================================================================
// QMI spec-flag override — homes marketed "Available Now" on the authoritative
// legacy site but flagged RHODES_SPEC_FLAG='No' (Pre-Sold) in MarkSystems must
// still be admitted by the QMI gate. The gate keeps the spec='Yes' requirement
// but ORs in a verified ECI allow-list, while leaving the not-Completed and
// whitelist-city guards intact so the override can't pull settled/out-of-region
// homes. See QMI_SPEC_FLAG_OVERRIDE_ECIS in snowflake.ts.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { qmisSql, QMI_SPEC_FLAG_OVERRIDE_ECIS, type SnowflakeEnv } from '../src/snowflake.js';

const env: SnowflakeEnv = {
  SNOWFLAKE_ACCOUNT: '<SNOWFLAKE_ACCOUNT>',
  SNOWFLAKE_USER: 'u',
  SNOWFLAKE_PASSWORD: 'p',
  SNOWFLAKE_DATABASE: '<SNOWFLAKE_DATABASE>',
  SNOWFLAKE_WAREHOUSE: '<SNOWFLAKE_WAREHOUSE>',
  SNOWFLAKE_SCHEMA: 'ANALYTICS_ZONE',
};

describe('qmisSql spec-flag override', () => {
  const sql = qmisSql(env);

  it('still requires spec=Yes as the primary gate', () => {
    expect(sql).toContain("h.RHODES_SPEC_FLAG = 'Yes'");
  });

  it('admits every override ECI via an OR clause', () => {
    for (const eci of QMI_SPEC_FLAG_OVERRIDE_ECIS) {
      expect(sql).toContain(`'${eci}'`);
    }
    expect(sql).toContain('OR h.ECI_KEY IN (');
  });

  it('includes 1413 Zurich (the verified Pre-Sold-but-available home)', () => {
    expect(QMI_SPEC_FLAG_OVERRIDE_ECIS).toContain('005VF00000135');
  });

  it('keeps the not-Completed and whitelist-city guards (override is not a bypass)', () => {
    expect(sql).toContain("h.SETTLEMENT_COMPLETION_FLAG != 'Completed'");
    expect(sql).toContain('h.HOUSE_CITY IN (');
    // The spec/override term is parenthesised so the AND guards bind to BOTH branches.
    expect(sql).toMatch(/WHERE \(h\.RHODES_SPEC_FLAG = 'Yes' OR h\.ECI_KEY IN \([^)]*\)\)\s+AND h\.SETTLEMENT_COMPLETION_FLAG/);
  });
});

describe('qmisSql active-sale exclusion (availability follows the sale lifecycle)', () => {
  const sql = qmisSql(env);

  it("excludes homes whose LATEST FCT_HOUSESALES transaction is an active sale", () => {
    // The home is dropped only when its newest transaction is sold / under contract.
    expect(sql).toContain("TRANSACTION_TYPE IN ('Sales from housemaster', 'Pending Sale')");
    expect(sql).toContain('h.HOUSE_ID NOT IN (');
    // "latest" = ROW_NUMBER over a per-house, date-descending window.
    expect(sql).toMatch(/ROW_NUMBER\(\)\s+OVER\s*\(\s*PARTITION BY HOUSE_ID\s+ORDER BY TRANSACTION_DATE DESC/);
    expect(sql).toContain('WHERE rn = 1');
  });

  it('seeds from exactly the latest Spec Home Inventory transaction per house', () => {
    expect(sql).toContain("WHERE TRANSACTION_TYPE = 'Spec Home Inventory'");
    expect(sql).toMatch(
      /QUALIFY ROW_NUMBER\(\)\s+OVER\s*\(\s*PARTITION BY HOUSE_ID\s+ORDER BY TRANSACTION_DATE DESC/
    );
  });
});
