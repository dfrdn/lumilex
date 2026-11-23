import { describe, expect, it } from 'vitest';
import { signingCity } from './formal-offer';

describe('signingCity', () => {
  it('reads the city off a one-line address and drops the postcode', () => {
    expect(signingCity(['12/F Example Tower, 1 Sample Street, Pasig City 1605, Metro Manila'])).toBe('Pasig City');
  });

  it('reads it from a second address line', () => {
    expect(signingCity(['Unit 4, Example Building', 'Cebu City 6000, Cebu'])).toBe('Cebu City');
  });

  it('takes the last city named, not a building called one', () => {
    expect(signingCity(['City Center Tower, Quezon City'])).toBe('Quezon City');
  });

  it('is null when the address names no city, so the document leaves a blank', () => {
    expect(signingCity(['Poblacion, San Juan, Batangas'])).toBeNull();
    expect(signingCity([''])).toBeNull();
  });
});
