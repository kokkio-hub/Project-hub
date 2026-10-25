import type { ColorName } from '../../shared/types';
import { N_, t } from '../i18n';

const COLOR_LABELS: Record<ColorName, string> = {
  blue: N_('Blue'),
  orange: N_('Orange'),
  aqua: N_('Aqua'),
  yellow: N_('Yellow'),
  magenta: N_('Magenta'),
  green: N_('Green'),
  violet: N_('Violet'),
  red: N_('Red'),
};

/** A colour's name in the interface language. */
export function colorLabel(color: ColorName): string {
  return t(COLOR_LABELS[color]);
}
