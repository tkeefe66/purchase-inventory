// auth.ts exports `handlers` (not GET/POST directly) — destructure here.
import { handlers } from '../../../../auth';

export const { GET, POST } = handlers;
