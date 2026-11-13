import base from '@nova/config/eslint';

// O client gerado pelo Prisma (`src/generated`) não é código nosso.
export default [{ ignores: ['src/generated/**'] }, ...base];
