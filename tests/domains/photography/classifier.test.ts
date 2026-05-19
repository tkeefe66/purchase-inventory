import { describe, it, expect } from 'vitest';
import { classifyPhotography } from '../../../domains/photography/classifier.js';

describe('classifyPhotography', () => {
  it('classifies a Sony camera body as Photography', () => {
    const result = classifyPhotography({
      itemName: 'Sony Alpha a6700 Mirrorless Camera Body',
      brand: 'Sony',
      source: 'Amazon',
    });
    expect(result.isMatch).toBe(true);
  });

  it('classifies a Sigma lens as Photography', () => {
    const result = classifyPhotography({
      itemName: 'Sigma 18-50mm f/2.8 DC DN Contemporary Lens',
      brand: 'Sigma',
      source: 'Amazon',
    });
    expect(result.isMatch).toBe(true);
  });

  it('classifies the Epson ET-8550 printer as Photography', () => {
    const result = classifyPhotography({
      itemName: 'Epson EcoTank Photo ET-8550 All-in-One Printer',
      brand: 'Epson',
      source: 'Amazon',
    });
    expect(result.isMatch).toBe(true);
  });

  it('classifies Lightroom subscription as Photography', () => {
    const result = classifyPhotography({
      itemName: 'Adobe Photography Plan (Lightroom + Photoshop)',
      brand: 'Adobe',
      source: 'Manual',
    });
    expect(result.isMatch).toBe(true);
  });

  it('does NOT classify a hiking boot as Photography', () => {
    const result = classifyPhotography({
      itemName: 'Salomon X Ultra 4 GTX Hiking Boots',
      brand: 'Salomon',
      source: 'REI',
    });
    expect(result.isMatch).toBe(false);
  });

  it('does NOT classify a kitchen knife as Photography', () => {
    const result = classifyPhotography({
      itemName: "Wusthof Classic 8-inch Chef's Knife",
      brand: 'Wusthof',
      source: 'Amazon',
    });
    expect(result.isMatch).toBe(false);
  });

  it('does NOT classify a flashlight as Photography', () => {
    const result = classifyPhotography({
      itemName: 'Coast HP7R Rechargeable Flashlight',
      brand: 'Coast',
      source: 'Amazon',
    });
    expect(result.isMatch).toBe(false);
  });

  it('does NOT classify an Epson office EcoTank printer as Photography', () => {
    const result = classifyPhotography({
      itemName: 'Epson EcoTank ET-2803 All-in-One Printer',
      brand: 'Epson',
      source: 'Amazon',
    });
    expect(result.isMatch).toBe(false);
  });

  it('classifies Sony a6700 body (minimal name) as Photography', () => {
    const result = classifyPhotography({
      itemName: 'Sony a6700 Body',
      brand: 'Sony',
      source: 'Manual',
    });
    expect(result.isMatch).toBe(true);
  });

  it('does NOT classify a Sony Active Speaker as Photography', () => {
    const result = classifyPhotography({
      itemName: 'Sony Active Speaker SRS-XB43',
      brand: 'Sony',
      source: 'Amazon',
    });
    expect(result.isMatch).toBe(false);
  });

  it('does NOT classify a Sony A80K OLED TV as Photography', () => {
    const result = classifyPhotography({
      itemName: 'Sony A80K 65-inch OLED TV',
      brand: 'Sony',
      source: 'Amazon',
    });
    expect(result.isMatch).toBe(false);
  });
});
