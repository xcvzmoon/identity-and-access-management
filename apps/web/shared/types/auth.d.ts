import type { User as DatabaseUser } from '@iam/shared/types';

declare module '#auth-utils' {
  interface User extends Pick<DatabaseUser, 'id' | 'name' | 'email'> {}
}

export {};
