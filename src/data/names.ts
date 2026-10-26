import { nextFloat, pick, type RngHolder } from '../core/rng.ts';
import type { CivDef } from './civs.ts';

const SYLLABLES: Record<CivDef['nameStyle'], { start: string[]; mid: string[]; end: string[] }> = {
  human: {
    start: ['Al', 'Bran', 'Cor', 'Ed', 'Gal', 'Hal', 'Mar', 'Ost', 'Ros', 'Val', 'Wes', 'Ard'],
    mid: ['a', 'e', 'en', 'or', 'ar', 'i', 'wyn', 'ber'],
    end: ['mark', 'land', 'gard', 'mere', 'ford', 'ria', 'helm', 'wick', 'ton', 'shire'],
  },
  dwarven: {
    start: ['Kar', 'Dur', 'Thor', 'Bal', 'Gor', 'Khaz', 'Dun', 'Brom', 'Grim'],
    mid: ['a', 'u', 'o', 'im', 'un', 'ak'],
    end: ['heim', 'dun', 'grund', 'khar', 'drak', 'mor', 'hold', 'barak'],
  },
  elven: {
    start: ['Ael', 'Sil', 'Lor', 'Ith', 'Cel', 'Eth', 'Myr', 'Faer', 'Ny'],
    mid: ['a', 'e', 'ia', 'ae', 'il', 'an', 'el'],
    end: ['wen', 'thil', 'lond', 'driel', 'nor', 'las', 'thas', 'riel', 'vael'],
  },
  orcish: {
    start: ['Gra', 'Ug', 'Mor', 'Zug', 'Skar', 'Gru', 'Thra', 'Kro', 'Vog'],
    mid: ['a', 'u', 'ak', 'og', 'ruk'],
    end: ['gash', 'nak', 'dush', 'grom', 'rok', 'buk', 'zar', 'gul'],
  },
  merchant: {
    start: ['Ves', 'Port', 'Sal', 'Mir', 'Cas', 'Lum', 'Bel', 'Ter', 'Aur'],
    mid: ['a', 'e', 'i', 'o', 'el', 'ar'],
    end: ['ezza', 'ano', 'ria', 'enza', 'ona', 'ica', 'alis', 'ora'],
  },
  nomad: {
    start: ['Kha', 'Tem', 'Ar', 'Sar', 'Bat', 'Ozk', 'Ja', 'Tug', 'Qar'],
    mid: ['a', 'u', 'ar', 'al', 'ir', 'ul'],
    end: ['khan', 'tai', 'gol', 'stan', 'mir', 'dar', 'jin', 'kur'],
  },
};

const STATE_TITLES: Record<CivDef['nameStyle'], string[]> = {
  human: ['Kingdom of', 'Duchy of', 'Realm of'],
  dwarven: ['Hold of', 'Deeprealm of', 'Thanedom of'],
  elven: ['Court of', 'Realm of', 'Sylvan Dominion of'],
  orcish: ['Clans of', 'Horde of', 'Warband of'],
  merchant: ['Republic of', 'Serene League of', 'Free City of'],
  nomad: ['Khanate of', 'Horde of', 'Ulus of'],
};

export function makeName(h: RngHolder, style: CivDef['nameStyle'], used: Set<string>): string {
  const s = SYLLABLES[style];
  for (let attempt = 0; attempt < 50; attempt++) {
    const mid = nextFloat(h) < 0.45 ? pick(h, s.mid) : '';
    const name = pick(h, s.start) + mid + pick(h, s.end);
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  const fallback = pick(h, s.start) + pick(h, s.end) + used.size;
  used.add(fallback);
  return fallback;
}

export function makeStateName(h: RngHolder, style: CivDef['nameStyle'], used: Set<string>): string {
  return `${pick(h, STATE_TITLES[style])} ${makeName(h, style, used)}`;
}

export const COUNTRY_COLORS = [
  '#c0392b', '#2e86c1', '#d4ac0d', '#8e44ad', '#17a589', '#d35400', '#5d6d7e',
  '#c2185b', '#1e8449', '#7b241c', '#2874a6', '#b9770e', '#6c3483', '#0e6655',
];
