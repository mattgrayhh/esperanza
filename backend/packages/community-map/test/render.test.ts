import { describe, it, expect } from 'vitest';
import { COMMUNITY_MAP_CSS } from '../css';

describe('COMMUNITY_MAP_CSS', () => {
  it('defines the pin + popup classes and the dark-green var', () => {
    expect(COMMUNITY_MAP_CSS).toContain('.qmi-pin-mpc');
    expect(COMMUNITY_MAP_CSS).toContain('.qmi-popup-title');
    expect(COMMUNITY_MAP_CSS).toContain('--qmi-dark-green');
    expect(COMMUNITY_MAP_CSS).toContain('.leaflet-popup-content');
  });
});
