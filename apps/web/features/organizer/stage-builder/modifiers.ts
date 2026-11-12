import type { Modifier } from '@dnd-kit/core';

/** As listas são verticais: o item arrastado não sai para os lados. */
export const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });
