import { describe, expect, it } from 'vitest';
import { actorName } from '../lib/activity-format';

describe('actorName', () => {
  it('labels Snowflake publication actors for the activity feed', () => {
    expect(actorName('ingest-autopublish')).toBe('Snowflake sync (auto-publish)');
    expect(actorName('ingest-snowflake-departure')).toBe('Snowflake sync (removed from feed)');
  });
});
