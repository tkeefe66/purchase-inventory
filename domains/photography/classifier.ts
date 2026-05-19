export type ClassifyInput = {
  itemName: string;
  brand: string | null;
  source: string;
};

export type ClassifyResult = {
  isMatch: boolean;
  confidence: number;
  category?: string;
  subCategory?: string;
};

const KEYWORDS_STRONG = [
  'camera', 'mirrorless', 'dslr', 'lens', 'tripod', 'gimbal',
  'speedlight', 'softbox', 'lightroom', 'capture one', 'photoshop',
  'photo printer', 'photo paper', 'icc profile',
  'sd card', 'cf card', 'memory card', 'card reader', 'shutter release',
  'remote release', 'lens hood', 'lens cap', 'lens filter', 'polarizer',
  'cpl filter', 'nd filter', 'uv filter', 'lens cleaning',
  'camera bag', 'camera strap', 'camera grip', 'battery grip',
  'np-fz100', 'np-fw50',
];

const KEYWORDS_BRAND = new Set([
  'sony alpha', 'sony fe',
  'sony a1', 'sony a5', 'sony a6', 'sony a7', 'sony a9',
  'sigma art', 'sigma contemporary', 'sigma sport',
  'tamron', 'rokinon', 'samyang', 'viltrox', 'tt artisan',
  'fujifilm x', 'fuji gfx', 'canon eos', 'canon rf', 'canon ef',
  'nikon z', 'nikon f', 'panasonic lumix', 'olympus om',
  'manfrotto', 'gitzo', 'peak design', 'think tank', 'lowepro',
  'wandrd', 'shimoda', 'f-stop', 'mindshift',
  'epson surecolor', 'epson ecotank photo', 'canon pixma pro',
  'godox', 'profoto', 'nanlite', 'aputure',
  'adobe creative cloud', 'adobe photography plan',
  'kase', 'breakthrough photography', 'nisi', 'haida', 'lee filters',
]);

export function classifyPhotography(input: ClassifyInput): ClassifyResult {
  const name = input.itemName.toLowerCase();
  const brand = (input.brand || '').toLowerCase();
  const combined = `${brand} ${name}`.trim();

  for (const phrase of KEYWORDS_BRAND) {
    if (combined.includes(phrase)) {
      return { isMatch: true, confidence: 0.95 };
    }
  }
  for (const kw of KEYWORDS_STRONG) {
    if (name.includes(kw)) {
      return { isMatch: true, confidence: 0.85 };
    }
  }
  return { isMatch: false, confidence: 0 };
}
