import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'intent',
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
